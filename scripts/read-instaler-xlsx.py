"""Read a local supplier XLSX as private snapshot evidence, without evaluation or writes."""

import argparse
from decimal import Decimal, InvalidOperation
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import posixpath
import re
import stat
import sys
import unicodedata
import xml.etree.ElementTree as ET
from xml.parsers import expat
import zipfile
import zlib


MAX_FILE_BYTES = 8 * 1024 * 1024
MAX_PART_BYTES = 16 * 1024 * 1024
MAX_TOTAL_BYTES = 64 * 1024 * 1024
MAX_OUTPUT_BYTES = 16 * 1024 * 1024
MAX_ZIP_ENTRIES = 4096
MAX_XML_NODES = 1000000
MAX_ROWS = 10000
MAX_CELLS = 200000
MAX_TEXT = 32767
MAIN_NAMESPACES = {
    "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "http://purl.oclc.org/ooxml/spreadsheetml/main",
}
REL_NAMESPACE = "http://schemas.openxmlformats.org/package/2006/relationships"
OFFICE_REL_NAMESPACES = (
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "http://purl.oclc.org/ooxml/officeDocument/relationships",
)
DECIMAL = re.compile(r"^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE]([+-]?[0-9]+))?$")
CELL_REFERENCE = re.compile(r"^([A-Z]{1,3})([1-9][0-9]{0,6})$")


class InvalidWorkbook(ValueError):
    pass


def reject(message):
    raise InvalidWorkbook(message)


def bounded_text(value):
    if len(value) > MAX_TEXT:
        reject("Cell text exceeds the supported limit.")
    return value


def normalized(value):
    if not isinstance(value, str):
        return ""
    return " ".join(
        "".join(char for char in unicodedata.normalize("NFD", value) if not unicodedata.combining(char))
        .lower().split()
    )


def namespace(root, expected):
    if not root.tag.startswith("{"):
        reject("Missing spreadsheet XML namespace.")
    uri, local = root.tag[1:].split("}", 1)
    if uri not in MAIN_NAMESPACES or local != expected:
        reject("Unexpected spreadsheet XML document.")
    return uri


def parse_xml(data):
    parser = expat.ParserCreate()
    depth = 0
    nodes = 0

    def start(_name, _attributes):
        nonlocal depth, nodes
        depth += 1
        nodes += 1
        if depth > 64 or nodes > MAX_XML_NODES:
            reject("Spreadsheet XML exceeds the supported complexity.")

    def end(_name):
        nonlocal depth
        depth -= 1

    def forbidden(*_args):
        reject("DTD and entity declarations are not supported.")

    parser.StartElementHandler = start
    parser.EndElementHandler = end
    parser.StartDoctypeDeclHandler = forbidden
    parser.EntityDeclHandler = forbidden
    parser.ExternalEntityRefHandler = forbidden
    parser.Parse(data, True)
    return ET.fromstring(data)


class Package:
    def __init__(self, data):
        self.archive = zipfile.ZipFile(io.BytesIO(data))
        infos = self.archive.infolist()
        if len(infos) > MAX_ZIP_ENTRIES:
            reject("Workbook has too many ZIP entries.")
        self.parts = {}
        total = 0
        for info in infos:
            name = info.filename
            path = PurePosixPath(name)
            if (not name or "\\" in name or "\x00" in name or name.startswith("/")
                    or any(part in ("", ".", "..") for part in name.rstrip("/").split("/"))
                    or ":" in name or path.is_absolute() or name in self.parts):
                reject("Unsafe or duplicate ZIP part name.")
            mode = info.external_attr >> 16
            if stat.S_ISLNK(mode) or info.flag_bits & 1:
                reject("Encrypted or linked ZIP entries are not supported.")
            if info.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                reject("Unsupported ZIP compression.")
            if info.file_size > MAX_PART_BYTES or info.file_size < 0:
                reject("Workbook part exceeds the supported size.")
            total += info.file_size
            if total > MAX_TOTAL_BYTES or (info.file_size > 1024 * 1024
                    and info.file_size > max(1, info.compress_size) * 1000):
                reject("Workbook ZIP expansion exceeds the supported limit.")
            self.parts[name] = info

    def xml(self, name, optional=False):
        info = self.parts.get(name)
        if info is None:
            if optional:
                return None
            reject("A required workbook part is missing.")
        with self.archive.open(info) as stream:
            data = stream.read(MAX_PART_BYTES + 1)
        if len(data) > MAX_PART_BYTES or len(data) != info.file_size:
            reject("Workbook part length is invalid.")
        return parse_xml(data)


def relationship_target(target):
    if not target or target.startswith("//") or "\\" in target or ":" in target or "?" in target or "#" in target:
        reject("Unsupported worksheet relationship target.")
    if any(part in (".", "..") for part in target.split("/")):
        reject("Unsafe worksheet relationship target.")
    name = target.lstrip("/") if target.startswith("/") else posixpath.join("xl", target)
    if not name.startswith("xl/") or "//" in name:
        reject("Worksheet relationship leaves the workbook package.")
    return name


def workbook_sheets(package):
    workbook = package.xml("xl/workbook.xml")
    uri = namespace(workbook, "workbook")
    relations = package.xml("xl/_rels/workbook.xml.rels")
    if relations.tag != "{" + REL_NAMESPACE + "}Relationships":
        reject("Unexpected workbook relationship namespace.")
    by_id = {}
    for relation in relations:
        if relation.tag != "{" + REL_NAMESPACE + "}Relationship":
            continue
        key = relation.get("Id")
        if not key or key in by_id:
            reject("Duplicate or missing workbook relationship identity.")
        by_id[key] = relation
    sheets = []
    names = set()
    for sheet in workbook.findall("{" + uri + "}sheets/{" + uri + "}sheet"):
        name = bounded_text(sheet.get("name", ""))
        if not name or name in names:
            reject("Duplicate or missing worksheet name.")
        names.add(name)
        relation_id = next((sheet.get("{" + item + "}id") for item in OFFICE_REL_NAMESPACES
                            if sheet.get("{" + item + "}id") is not None), None)
        relation = by_id.get(relation_id)
        if relation is None or not relation.get("Type", "").endswith("/worksheet"):
            reject("Missing worksheet relationship.")
        if relation.get("TargetMode") == "External":
            reject("External worksheets are not supported.")
        sheets.append({"name": name, "state": sheet.get("state", "visible"),
                       "part": relationship_target(relation.get("Target", ""))})
    if not sheets:
        reject("Workbook has no worksheets.")
    return sheets


def rich_text(element, uri):
    if element is None:
        return ""
    parts = []
    for child in element:
        if child.tag == "{" + uri + "}t":
            parts.append(child.text or "")
        elif child.tag == "{" + uri + "}r":
            text = child.find("{" + uri + "}t")
            if text is not None:
                parts.append(text.text or "")
    return bounded_text("".join(parts))


def shared_strings(package):
    root = package.xml("xl/sharedStrings.xml", optional=True)
    if root is None:
        return []
    uri = namespace(root, "sst")
    strings = [rich_text(item, uri) for item in root.findall("{" + uri + "}si")]
    if len(strings) > 200000:
        reject("Too many shared strings.")
    return strings


def cell_styles(package):
    root = package.xml("xl/styles.xml", optional=True)
    if root is None:
        return []
    uri = namespace(root, "styleSheet")
    formats = {}
    for item in root.findall("{" + uri + "}numFmts/{" + uri + "}numFmt"):
        key = item.get("numFmtId", "")
        if not key.isdigit() or key in formats:
            reject("Invalid number-format identity.")
        formats[key] = bounded_text(item.get("formatCode", ""))
    styles = []
    for item in root.findall("{" + uri + "}cellXfs/{" + uri + "}xf"):
        key = item.get("numFmtId", "0")
        if not key.isdigit():
            reject("Invalid cell number format.")
        styles.append({"numberFormatId": int(key),
                       **({"numberFormat": formats[key]} if key in formats else {})})
    return styles


def numeric_value(raw):
    if raw is None:
        return None
    match = DECIMAL.fullmatch(raw)
    if not match or len(raw) > 500:
        return raw
    exponent = match.group(1)
    if exponent is not None and (len(exponent.lstrip("+-")) > 3 or abs(int(exponent)) > 500):
        return raw
    try:
        value = format(Decimal(raw), "f")
    except InvalidOperation:
        return raw
    return value if len(value) <= 500 else raw


def column_index(letters):
    result = 0
    for letter in letters:
        result = result * 26 + ord(letter) - ord("A") + 1
    if result > 16384:
        reject("Cell column exceeds the worksheet limit.")
    return result


def read_cell(cell, uri, row_number, previous_column, strings, styles):
    reference = cell.get("r", "")
    match = CELL_REFERENCE.fullmatch(reference)
    if match is None or int(match.group(2)) != row_number:
        reject("Invalid cell coordinate.")
    letters = match.group(1)
    column = column_index(letters)
    if column <= previous_column:
        reject("Duplicate or unordered cell coordinate.")
    if column > 12:
        return column, None
    kind = cell.get("t", "n")
    value_nodes = cell.findall("{" + uri + "}v")
    formula_nodes = cell.findall("{" + uri + "}f")
    inline_nodes = cell.findall("{" + uri + "}is")
    if len(value_nodes) > 1 or len(formula_nodes) > 1 or len(inline_nodes) > 1:
        reject("Ambiguous cell value or formula.")
    if inline_nodes and kind != "inlineStr":
        reject("Unexpected inline-string data for the cell type.")
    raw = bounded_text(value_nodes[0].text) if value_nodes and value_nodes[0].text is not None else None
    formula = formula_nodes[0] if formula_nodes else None
    if kind == "s":
        if raw is None:
            value = None
        elif not raw.isdigit() or int(raw) >= len(strings):
            reject("Invalid shared-string reference.")
        else:
            value = strings[int(raw)]
    elif kind == "inlineStr":
        if formula is not None or value_nodes:
            reject("Ambiguous inline-string cell.")
        value = rich_text(inline_nodes[0], uri) if inline_nodes else None
        raw = value
    elif kind == "b":
        if raw not in (None, "0", "1"):
            reject("Invalid boolean cell.")
        value = None if raw is None else raw == "1"
    elif kind in ("str", "e", "d"):
        value = raw
    elif kind == "n":
        value = numeric_value(raw)
    else:
        reject("Unsupported spreadsheet cell type.")
    result = {"column": letters, "reference": reference, "type": kind, "value": value,
              "rawValue": raw, "hasCachedValue": bool(value_nodes and value_nodes[0].text is not None)}
    if formula is not None:
        result["formula"] = bounded_text(formula.text or "")
        if formula.attrib:
            result["formulaAttributes"] = dict(formula.attrib)
    style = cell.get("s")
    if style is not None:
        if not style.isdigit() or int(style) >= len(styles):
            reject("Invalid cell style reference.")
        result.update(styles[int(style)])
    elif styles:
        result.update(styles[0])
    return column, result


def worksheet_rows(package, name, strings, styles):
    root = package.xml(name)
    uri = namespace(root, "worksheet")
    rows = []
    previous_row = 0
    total_cells = 0
    evidence_bytes = 0
    for row in root.findall("{" + uri + "}sheetData/{" + uri + "}row"):
        position = row.get("r", "")
        if not position.isdigit() or not previous_row < int(position) <= 1000000:
            reject("Duplicate, missing or unordered row coordinate.")
        number = int(position)
        previous_row = number
        if len(rows) >= MAX_ROWS:
            reject("Worksheet has too many rows.")
        cells = []
        values = [None] * 5
        previous_column = 0
        for cell in row.findall("{" + uri + "}c"):
            total_cells += 1
            if total_cells > MAX_CELLS:
                reject("Worksheet has too many cells.")
            column, evidence = read_cell(cell, uri, number, previous_column, strings, styles)
            previous_column = column
            if evidence is not None:
                # Shared-string references must not amplify a tiny ZIP into an unbounded report.
                evidence_bytes += len(json.dumps(evidence, ensure_ascii=True, separators=(",", ":")).encode("utf-8"))
                if evidence_bytes > MAX_OUTPUT_BYTES:
                    reject("Extracted evidence exceeds the supported output size.")
                cells.append(evidence)
                if column <= 5:
                    values[column - 1] = evidence["value"]
        rows.append({"row": number, "values": values, "cells": cells})
    return rows


def header_layout(values):
    headers = [normalized(value) for value in values]
    if headers == ["sku", "descripcion", "precio", "stock", "categoria"]:
        return "canonical-a-e"
    if headers[1:] == ["instaler", "precio", "stock", "producto"]:
        return "supplier-precios-a-e"
    return None


def extract(path):
    with path.open("rb") as stream:
        data = stream.read(MAX_FILE_BYTES + 1)
    if len(data) > MAX_FILE_BYTES:
        reject("Workbook exceeds the supported file size.")
    package = Package(data)
    sheets = workbook_sheets(package)
    target = next((sheet for sheet in sheets if sheet["name"] == "Precios"), None)
    if target is None:
        reject("The required Precios worksheet is missing.")
    rows = worksheet_rows(package, target["part"], shared_strings(package), cell_styles(package))
    candidates = [(row, header_layout(row["values"])) for row in rows if row["row"] <= 100]
    candidates = [(row, layout) for row, layout in candidates if layout is not None]
    if len(candidates) != 1:
        reject("A unique supported Precios header could not be verified.")
    header, layout = candidates[0]
    unit_columns = {}
    for cell in header["cells"]:
        if column_index(cell["column"]) > 5:
            title = normalized(cell["value"])
            key = "unit" if title in ("unidad", "unit") else "presentation" if title in ("presentacion", "presentation") else None
            if key:
                if key in unit_columns:
                    reject("Ambiguous unit or presentation column.")
                unit_columns[key] = cell["column"]
    extracted_rows = [row for row in rows if row["row"] > header["row"]]
    for row in extracted_rows:
        for key, column in unit_columns.items():
            cell = next((cell for cell in row["cells"] if cell["column"] == column), None)
            if cell is not None and isinstance(cell["value"], str) and cell["value"].strip():
                row[key] = cell["value"].strip()
    other_sheets = [sheet["name"] for sheet in sheets if sheet["name"] != "Precios"]
    return {
        "format": "luquisound.instaler-xlsx-extraction", "version": 1,
        "source": {"document": path.name, "checksum": hashlib.sha256(data).hexdigest(), "byteLength": len(data)},
        "sheet": "Precios", "headerRow": header["row"], "headerLayout": layout,
        "headers": header["values"], "headerCells": header["cells"], "rows": extracted_rows,
        "sheets": [{"name": sheet["name"], "state": sheet["state"]} for sheet in sheets],
        "coverage": {"complete": False, "kits": "pending", "units": "explicit-columns" if unit_columns else "pending",
                     "unitColumns": unit_columns, "otherSheets": other_sheets,
                     "externalLinksPresent": any(name.startswith("xl/externalLinks/") for name in package.parts),
                     "connectionsPresent": "xl/connections.xml" in package.parts},
    }


def encode_output(result):
    parts = []
    length = 1  # Include the final newline in the byte limit.
    for part in json.JSONEncoder(ensure_ascii=True, separators=(",", ":")).iterencode(result):
        length += len(part.encode("utf-8"))
        if length > MAX_OUTPUT_BYTES:
            reject("Extracted evidence exceeds the supported output size.")
        parts.append(part)
    return "".join(parts)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", type=Path, help="Local XLSX file to read without modification")
    args = parser.parse_args()
    try:
        if args.path.suffix.lower() != ".xlsx" or not args.path.is_file():
            reject("A local XLSX file is required.")
        result = extract(args.path)
        output = encode_output(result)
        sys.stdout.write(output + "\n")
    except (OSError, ValueError, ET.ParseError, expat.ExpatError, zipfile.BadZipFile,
            zlib.error, EOFError, RuntimeError, NotImplementedError) as error:
        # Do not echo source cell contents, formulas, URLs or absolute paths on failure.
        message = str(error) if isinstance(error, InvalidWorkbook) else "Malformed or unreadable XLSX package."
        sys.stderr.write("Cannot read supplier snapshot: " + message + "\n")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())

export default function HomePage() {
  return (
    <div className="page-shell flex min-h-svh flex-col bg-black text-white">
      <header className="mx-auto w-full max-w-6xl border-b border-white/20 py-6 sm:py-8">
        <p className="text-sm font-bold tracking-[0.16em]">LUQUISOUND</p>
        <p className="mt-1 text-sm text-white/70">Audio automotor</p>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 items-center py-14 sm:py-20">
        <section aria-labelledby="page-title" className="w-full max-w-3xl">
          <p className="mb-5 text-sm font-semibold tracking-wide text-brand-yellow">
            Presupuestos personalizados
          </p>
          <h1 id="page-title" className="text-4xl leading-tight font-bold tracking-tight sm:text-6xl lg:text-7xl">
            Cotizador <span className="block text-brand-yellow">Luquisound</span>
          </h1>
          <p className="mt-6 max-w-lg text-base leading-relaxed text-white/80 sm:text-lg">
            Cada proyecto de audio tiene su propio sonido. Su presupuesto también.
          </p>

          <div className="mt-10 max-w-lg rounded-2xl border-t-4 border-brand-yellow bg-white p-6 text-black sm:p-8">
            <h2 className="text-lg font-bold">Próximamente</h2>
            <p className="mt-2 text-base leading-relaxed">
              Estamos preparando una herramienta para crear los presupuestos del taller, desde tu celular.
            </p>
          </div>
        </section>
      </main>

      <footer className="mx-auto w-full max-w-6xl border-t border-white/20 py-6 text-sm text-white/60">
        Luquisound · Taller de audio automotor
      </footer>
    </div>
  )
}

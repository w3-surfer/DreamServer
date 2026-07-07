import { useCallback, useEffect, useState } from 'react'
import { Wallet, Copy, Check, RefreshCw, Droplet } from 'lucide-react'

const PANEL_STYLE = {
  background:
    'linear-gradient(180deg, rgba(18,18,25,0.94), rgba(8,8,16,0.96)), repeating-linear-gradient(90deg, transparent 0 47px, rgba(255,255,255,0.025) 47px 48px), repeating-linear-gradient(180deg, transparent 0 47px, rgba(255,255,255,0.025) 47px 48px)',
  borderColor: 'rgba(255,255,255,0.08)',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.045), 0 18px 40px rgba(0,0,0,0.22)',
}

const TILE_STYLE = {
  background:
    'linear-gradient(145deg, rgba(255,255,255,0.045), rgba(255,255,255,0.018)), linear-gradient(180deg, rgba(20,20,28,0.92), rgba(10,10,18,0.95))',
  borderColor: 'rgba(255,255,255,0.08)',
}

async function apiGet(path) {
  const res = await fetch(path)
  if (!res.ok) {
    const err = new Error(`request failed: ${res.status}`)
    err.status = res.status
    throw err
  }
  return res.json()
}

export default function SolanaWallet() {
  const [config, setConfig] = useState(null)
  const [wallet, setWallet] = useState(null)
  const [balance, setBalance] = useState(null)
  const [phase, setPhase] = useState('loading') // loading | ready | disabled | error
  const [copied, setCopied] = useState(false)
  const [airdropping, setAirdropping] = useState(false)
  const [notice, setNotice] = useState(null)

  const loadBalance = useCallback(async () => {
    try {
      setBalance(await apiGet('/api/solana/balance'))
    } catch {
      /* transient — keep the last known balance */
    }
  }, [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [cfg, w] = await Promise.all([
          apiGet('/api/solana/config'),
          apiGet('/api/solana/wallet'),
        ])
        if (!alive) return
        setConfig(cfg)
        setWallet(w)
        setPhase('ready')
        loadBalance()
      } catch (err) {
        if (!alive) return
        setPhase(err.status === 503 ? 'disabled' : 'error')
      }
    })()
    return () => {
      alive = false
    }
  }, [loadBalance])

  useEffect(() => {
    if (phase !== 'ready') return undefined
    const timer = setInterval(loadBalance, 10000)
    return () => clearInterval(timer)
  }, [phase, loadBalance])

  const copyAddress = async () => {
    if (!wallet?.pubkey) return
    try {
      await navigator.clipboard.writeText(wallet.pubkey)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked — no-op */
    }
  }

  const requestAirdrop = async () => {
    setAirdropping(true)
    setNotice(null)
    try {
      const res = await fetch('/api/solana/airdrop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sol: 1 }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || data.error || 'Airdrop failed')
      setNotice({ ok: true, text: 'Airdrop confirmed — balance updates shortly.' })
      loadBalance()
    } catch (err) {
      setNotice({ ok: false, text: String(err.message || err) })
    } finally {
      setAirdropping(false)
    }
  }

  const network = config?.network || 'devnet'
  const isDevnet = network.includes('devnet') || network.includes('testnet')

  const Header = (
    <div className="flex items-center gap-3 mb-6">
      <Wallet size={22} className="text-white/80" />
      <h1 className="text-xl font-semibold text-white">Solana Wallet</h1>
      {phase === 'ready' && (
        <span className="ml-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-xs text-white/70">
          {network}
        </span>
      )}
    </div>
  )

  if (phase === 'loading') {
    return (
      <div className="p-8">
        {Header}
        <p className="text-sm text-white/50">Loading wallet…</p>
      </div>
    )
  }

  if (phase === 'disabled' || phase === 'error') {
    const disabled = phase === 'disabled'
    return (
      <div className="p-8">
        {Header}
        <div className="rounded-2xl border p-6" style={PANEL_STYLE}>
          <p className="text-sm text-white/70">
            {disabled
              ? 'The Solana extension is not enabled.'
              : 'The Solana service is unreachable.'}
          </p>
          <p className="mt-2 text-sm text-white/50">
            {disabled
              ? 'Enable it from the Extensions page (or run `ods enable solana`), then reload.'
              : 'Check that the solana service is running, then reload.'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8">
      {Header}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Address + QR */}
        <div className="rounded-2xl border p-6" style={PANEL_STYLE}>
          <h2 className="mb-4 text-sm font-semibold text-white/60">Wallet address</h2>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            {wallet?.qr && (
              <img
                src={wallet.qr}
                alt="Wallet address QR code"
                width={128}
                height={128}
                className="h-32 w-32 shrink-0 rounded-lg bg-white p-2"
              />
            )}
            <div className="min-w-0">
              <p className="break-all font-mono text-sm text-white/90">{wallet?.pubkey || '—'}</p>
              <button
                type="button"
                onClick={copyAddress}
                className="mt-3 inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/80 hover:bg-white/10"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? 'Copied' : 'Copy address'}
              </button>
            </div>
          </div>
        </div>

        {/* Balance + airdrop */}
        <div className="rounded-2xl border p-6" style={TILE_STYLE}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white/60">Balance</h2>
            <button
              type="button"
              onClick={loadBalance}
              className="text-white/40 hover:text-white/80"
              title="Refresh balance"
            >
              <RefreshCw size={15} />
            </button>
          </div>
          <p className="font-mono text-3xl font-semibold text-white">
            {balance?.sol ?? '—'} <span className="text-lg text-white/50">SOL</span>
          </p>

          {isDevnet && (
            <button
              type="button"
              onClick={requestAirdrop}
              disabled={airdropping}
              className="mt-5 inline-flex items-center gap-2 rounded-lg border border-emerald-400/30 bg-emerald-400/15 px-4 py-2 text-sm font-medium text-emerald-200 hover:bg-emerald-400/25 disabled:opacity-50"
            >
              <Droplet size={15} />
              {airdropping ? 'Requesting…' : 'Request 1 devnet SOL'}
            </button>
          )}

          {notice && (
            <p className={`mt-4 text-xs ${notice.ok ? 'text-emerald-300' : 'text-amber-300'}`}>
              {notice.text}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

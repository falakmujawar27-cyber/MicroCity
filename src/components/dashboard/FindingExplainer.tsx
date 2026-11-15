import { useState } from 'react'
import type { Finding } from '../../domain/analysis'
import { useAuth } from '../../auth/auth-context'
import { api, ApiError } from '../../lib/api'
import { Badge, SeverityBadge } from '../ui/Badge'
import Notice from '../ui/Notice'
import { titleCase } from '../../lib/format'

/**
 * Every finding carries its computed evidence and limitations. The rule-based
 * explanation is always available; the optional AI narrative is clearly
 * labelled and cannot change or authorise anything.
 */
export default function FindingExplainer({
  finding,
  methods,
  compact = false,
}: {
  finding: Finding
  methods?: string[]
  compact?: boolean
}) {
  const { ai, role } = useAuth()
  const [aiText, setAiText] = useState<string | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)
  const [rejected, setRejected] = useState(false)
  const [busy, setBusy] = useState(false)
  const canUseAi = ai?.configured && (role === 'admin' || role === 'estates' || role === 'maintenance')

  const askAi = async () => {
    setBusy(true)
    setAiError(null)
    setRejected(false)
    try {
      const result = await api.aiAssist({
        task: 'explain-finding',
        finding: {
          id: finding.id,
          module: finding.module,
          severity: finding.severity,
          title: finding.title,
          summary: finding.summary,
          evidence: finding.evidence,
          limitations: finding.limitations,
          facts: finding.facts,
        },
      })
      if (result.ok && result.accepted && result.text) setAiText(result.text)
      else if (result.ok && result.accepted === false) setRejected(true)
      else setAiError(result.error ?? 'The assistant did not return an explanation.')
    } catch (err) {
      setAiError(
        err instanceof ApiError
          ? `${err.message} The calculated explanation above is unaffected.`
          : 'The assistant could not be reached. The calculated explanation above is unaffected.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={compact ? 'space-y-3' : 'space-y-5'}>
      {!compact && (
        <div className="flex flex-wrap items-center gap-2">
          <SeverityBadge severity={finding.severity} />
          <Badge tone="outline">{titleCase(finding.module)}</Badge>
          <span className="font-mono text-[0.625rem] text-ivory/40">{finding.id}</span>
        </div>
      )}
      {!compact && (
        <div>
          <h3 className="font-heading text-xl text-ivory">{finding.title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-ivory/75">{finding.summary}</p>
        </div>
      )}

      {!compact && <div className="border border-violet/40 bg-ink/60 p-4">
        <p className="flex items-center gap-2 font-mono text-[0.625rem] uppercase tracking-widest text-violet-bright">
          <span aria-hidden="true" className="inline-block h-2 w-2 border border-violet-bright" />
          Rule-based explanation — not AI
        </p>
        <div className="mt-3 space-y-3 text-sm">
          <div>
            <p className="font-mono text-[0.625rem] uppercase tracking-widest text-ivory/45">What the records show</p>
            {finding.evidence.length > 0 ? (
              <ul className="mt-1 space-y-1 text-ivory/75">
                {finding.evidence.map((item, index) => (
                  <li key={index} className="flex gap-2">
                    <span aria-hidden="true" className="mt-1 h-1 w-1 shrink-0 bg-gold" />
                    {item}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-ivory/50">No supporting records were listed for this finding.</p>
            )}
          </div>
          <div>
            <p className="font-mono text-[0.625rem] uppercase tracking-widest text-ivory/45">What this cannot tell you</p>
            {finding.limitations.length > 0 ? (
              <ul className="mt-1 space-y-1 text-ivory/60">
                {finding.limitations.map((item, index) => (
                  <li key={index} className="flex gap-2">
                    <span aria-hidden="true" className="mt-1 h-1 w-1 shrink-0 bg-ivory/40" />
                    {item}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-ivory/50">No specific limitation was recorded for this finding.</p>
            )}
          </div>
          {methods && methods.length > 0 && (
            <div>
              <p className="font-mono text-[0.625rem] uppercase tracking-widest text-ivory/45">How it was worked out</p>
              <ul className="mt-1 space-y-1 text-xs leading-relaxed text-ivory/55">
                {methods.map((item, index) => (
                  <li key={index}>• {item}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>}

      <div>
        {!compact && (
          <p className="font-mono text-[0.625rem] uppercase tracking-widest text-ivory/45">
            Optional narrative
          </p>
        )}
        {!ai?.configured ? (
          !compact && (
            <p className="mt-1 text-xs leading-relaxed text-ivory/50">
              AI is not configured on this server. No narrative is generated; the calculated explanation above is
              complete on its own.
            </p>
          )
        ) : !canUseAi ? (
          !compact && (
            <p className="mt-1 text-xs leading-relaxed text-ivory/50">
              AI explanations are available to estates and maintenance roles. Your role can still read all the
              supporting records.
            </p>
          )
        ) : (
          <div className="mt-2 space-y-3">
            <button
              type="button"
              onClick={() => void askAi()}
              disabled={busy}
              className="rounded-md border border-gold/60 px-3 py-1.5 text-xs font-semibold text-gold hover:bg-gold/10 focus-ring disabled:opacity-50"
            >
              {busy ? 'Asking the assistant…' : aiText ? 'Explain in plain words (AI)' : 'Explain in plain words (AI)'}
            </button>
            {aiError && <Notice tone="warning">{aiError}</Notice>}
            {rejected && (
              <Notice tone="warning" title="Rule-based explanation">
                AI answer rejected: unsupported number. The rule-based explanation above is shown instead; no AI text
                was stored.
              </Notice>
            )}
            {aiText && (
              <div className="border border-gold/60 bg-gold/5 p-4">
                <p className="flex items-center gap-2 font-mono text-[0.625rem] uppercase tracking-widest text-gold">
                  <span aria-hidden="true">◆</span> AI-generated, please verify
                </p>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ivory/80">{aiText}</p>
                <p className="mt-3 text-xs text-ivory/45">
                  Generated by {ai.model ?? 'the configured model'} from the facts above. It cannot change
                  records, approve decisions or replace human judgement.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

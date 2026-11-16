import { Badge } from './Badge'
import type { EvidenceBasis } from '../../domain/types'

const LABELS: Record<EvidenceBasis, string> = {
  measured: 'Measured',
  estimated: 'Estimated',
  illustrative: 'Illustrative',
}

export function basisLabel(basis: EvidenceBasis | null | undefined): string {
  return basis ? LABELS[basis] : 'Not recorded'
}

/** The row's own basis tag, shown wherever a record is listed. */
export default function BasisTag({ basis }: { basis: EvidenceBasis | null | undefined }) {
  const tone = basis === 'measured' ? 'ok' : basis === 'estimated' ? 'warn' : basis === 'illustrative' ? 'violet' : 'outline'
  return <Badge tone={tone}>{basisLabel(basis)}</Badge>
}

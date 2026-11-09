import type { Outcome, Status } from './schemas';

export interface ConfidenceInput {
  identification: 'license_number' | 'exact_unique_name' | 'user_selected';
  nameMatch: 'exact' | 'partial' | 'none';
  hasNumber: boolean;
  status: Status;
  statusEvidenceValidated: boolean;
  hasStatusExcerpt: boolean;
  conflicting: boolean;
}

/** Confidence is derived from evidence quality only; there is no model-produced percentage. */
export function computeConfidence(i: ConfidenceInput): { level: 'high' | 'medium' | 'low'; outcome: Outcome; reasons: string[] } {
  if (i.conflicting) return { level: 'low', outcome: 'partially_verified', reasons: ['The source presented conflicting information.'] };
  const reasons: string[] = [];
  if (i.identification === 'user_selected') reasons.push('Record chosen by the user from several candidates.');
  else if (i.identification === 'license_number') reasons.push('Matched by the licence/registration number you supplied.');
  else reasons.push('Single candidate whose name matches exactly.');
  if (i.nameMatch === 'partial') reasons.push('Name only partially matches the submitted name.');
  if (!i.hasNumber) reasons.push('No licence/registration number was extracted.');
  if (i.status === 'unknown') reasons.push('The source status could not be mapped to a known status.');
  if (i.statusEvidenceValidated) reasons.push('Status excerpt was found on the independently fetched source page.');
  else reasons.push(i.hasStatusExcerpt ? 'Status excerpt could not be re-confirmed on an independently fetched copy of the page.' : 'No supporting excerpt for the status was captured.');

  const solid = i.hasNumber && i.status !== 'unknown' && i.nameMatch !== 'none' &&
    (i.identification === 'license_number' || i.identification === 'user_selected' || i.nameMatch === 'exact');
  if (solid && i.statusEvidenceValidated) return { level: 'high', outcome: 'verified', reasons };
  if (solid || (i.status !== 'unknown' && i.nameMatch !== 'none')) return { level: 'medium', outcome: 'partially_verified', reasons };
  return { level: 'low', outcome: 'partially_verified', reasons };
}

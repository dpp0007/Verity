export type MonitorStatus = 'creating' | 'active' | 'paused' | 'failed' | 'removed';
export type MonitorAction = 'pause' | 'resume' | 'check' | 'remove';

const ALLOWED: Record<MonitorAction, MonitorStatus[]> = {
  pause: ['active'],
  resume: ['paused'],
  check: ['active', 'paused', 'failed'],
  remove: ['creating', 'active', 'paused', 'failed'],
};

export const canTransition = (from: MonitorStatus, action: MonitorAction): boolean => ALLOWED[action].includes(from);
export const targetStatus = (a: 'pause' | 'resume'): MonitorStatus => (a === 'pause' ? 'paused' : 'active');

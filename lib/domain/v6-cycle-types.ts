export type CycleMode = 'calendar_month' | 'salary_based' | 'custom';
export type FundingKind = 'salary' | 'bonus' | 'freelance' | 'business' | 'family_transfer' | 'savings_draw' | 'other';
export type FundingSource = { id: string; type: FundingKind; amount: number; occurredAt: string; includedInCycle: boolean; note?: string };

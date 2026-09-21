// Built-in searches and the category list shared with community submissions.
// Category keys are stored in the database, so never rename a key; change its label instead.

export const CATEGORIES = [
  { key: 'cleanup', label: 'Cleanup & storage' },
  { key: 'follow-up', label: 'Follow-up' },
  { key: 'finance', label: 'Invoices & finance' },
  { key: 'security', label: 'Security & accounts' },
  { key: 'newsletters', label: 'Newsletters & marketing' },
  { key: 'orders', label: 'Orders & shipping' },
  { key: 'attachments', label: 'Attachments' },
  { key: 'meetings', label: 'Meetings & scheduling' },
  { key: 'other', label: 'Other' },
];

export const CATEGORY_KEYS = new Set(CATEGORIES.map((c) => c.key));

export function categoryLabel(key) {
  return CATEGORIES.find((c) => c.key === key)?.label || 'Other';
}

export const BUILT_INS = [
  {
    id: 'large-messages',
    title: 'Large messages',
    category: 'cleanup',
    criteria: { sizeOp: '>', sizeMb: '10' },
  },
  {
    id: 'large-attachments-old',
    title: 'Large attachments from last year',
    category: 'cleanup',
    criteria: { hasAttachments: 'yes', sizeOp: '>', sizeMb: '5', dateMode: 'preset', datePreset: 'last year' },
  },
  {
    id: 'unread',
    title: 'Everything unread',
    category: 'follow-up',
    criteria: { read: 'no' },
  },
  {
    id: 'unread-this-week',
    title: 'Unread from this week',
    category: 'follow-up',
    criteria: { read: 'no', dateMode: 'preset', datePreset: 'this week' },
  },
  {
    id: 'flagged',
    title: 'Flagged for follow-up',
    category: 'follow-up',
    criteria: { flagged: 'yes' },
  },
  {
    id: 'high-importance',
    title: 'High importance',
    category: 'follow-up',
    criteria: { importance: 'high' },
  },
  {
    id: 'invoices',
    title: 'Invoices and receipts',
    category: 'finance',
    criteria: { anyWords: 'invoice receipt statement', hasAttachments: 'yes' },
  },
  {
    id: 'payment-due',
    title: 'Payment reminders',
    category: 'finance',
    criteria: { subject: 'payment', anyWords: 'overdue due reminder' },
  },
  {
    id: 'security-codes',
    title: 'Sign-in codes and security alerts',
    category: 'security',
    criteria: { anyWords: 'verification password sign-in security', dateMode: 'preset', datePreset: 'last month' },
  },
  {
    id: 'password-resets',
    title: 'Password reset emails',
    category: 'security',
    criteria: { phrase: 'reset your password' },
  },
  {
    id: 'newsletters',
    title: 'Newsletters and mailing lists',
    category: 'newsletters',
    criteria: { allWords: 'unsubscribe' },
  },
  {
    id: 'old-newsletters',
    title: 'Old newsletters to clear out',
    category: 'newsletters',
    criteria: { allWords: 'unsubscribe', dateMode: 'preset', datePreset: 'last year' },
  },
  {
    id: 'shipping',
    title: 'Shipping and delivery updates',
    category: 'orders',
    criteria: { anyWords: 'shipped tracking delivered delivery' },
  },
  {
    id: 'order-confirmations',
    title: 'Order confirmations',
    category: 'orders',
    criteria: { phrase: 'order confirmation' },
  },
  {
    id: 'pdf-attachments',
    title: 'PDF attachments',
    category: 'attachments',
    criteria: { attachmentName: 'pdf', hasAttachments: 'yes' },
  },
  {
    id: 'attachments-this-week',
    title: 'Attachments received this week',
    category: 'attachments',
    criteria: { hasAttachments: 'yes', dateMode: 'preset', datePreset: 'this week' },
  },
  {
    id: 'meeting-responses',
    title: 'Meeting accept and decline replies',
    category: 'meetings',
    criteria: { anyWords: 'Accepted Declined Tentative', hasAttachments: 'no' },
  },
  {
    id: 'out-of-office',
    title: 'Out-of-office auto-replies',
    category: 'meetings',
    criteria: { subject: 'Automatic reply' },
  },
];

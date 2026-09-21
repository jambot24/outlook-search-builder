// Built-in searches and the category list shared with community submissions.
// Category keys are stored in the database, so never rename a key; change its label instead.

export const CATEGORIES = [
  { key: 'inbox-zero', label: 'Inbox zero' },
  { key: 'cleanup', label: 'Cleanup & storage' },
  { key: 'follow-up', label: 'Follow-up' },
  { key: 'finance', label: 'Invoices & finance' },
  { key: 'security', label: 'Security & accounts' },
  { key: 'newsletters', label: 'Newsletters & marketing' },
  { key: 'orders', label: 'Orders & shipping' },
  { key: 'attachments', label: 'Attachments & file sharing' },
  { key: 'meetings', label: 'Meetings & scheduling' },
  { key: 'other', label: 'Other' },
];

export const CATEGORY_KEYS = new Set(CATEGORIES.map((c) => c.key));

export function categoryLabel(key) {
  return CATEGORIES.find((c) => c.key === key)?.label || 'Other';
}

// Optional per search: note (a limit worth knowing) and action (what to do with the results).
export const BUILT_INS = [
  {
    id: 'iz-read-old',
    title: 'Read mail older than 30 days',
    category: 'inbox-zero',
    criteria: { read: 'yes', dateMode: 'older', days: '30' },
    action: 'Select all (Ctrl+A or Cmd+A) and Archive. Everything here has been read, and Archive keeps it searchable.',
  },
  {
    id: 'iz-newsletters',
    title: 'Newsletters and promotions',
    category: 'inbox-zero',
    criteria: { anyWords: 'unsubscribe "opt out" "email preferences" "view in browser"' },
    action: 'Sort by From, keep the few you read, then select the rest and Archive. For senders you never open, use Unsubscribe, or Sweep in new Outlook and on the web.',
  },
  {
    id: 'iz-notifications',
    title: 'Automated notifications',
    category: 'inbox-zero',
    criteria: { anyWords: 'noreply "no-reply" donotreply "do not reply" "automated message" notification' },
    action: 'Archive them all, then make a rule for the senders that keep coming back so they skip the inbox.',
  },
  {
    id: 'iz-meeting-responses',
    title: 'Meeting accepts and declines',
    category: 'inbox-zero',
    criteria: { anyWords: 'Accepted Declined Tentative', hasAttachments: 'no' },
    note: 'Matches those words anywhere in a message, so glance down the list before deleting.',
    action: 'Delete the responses. Each one is already recorded on the meeting in your calendar.',
  },
  {
    id: 'iz-unread-stale',
    title: 'Unread for more than two weeks',
    category: 'inbox-zero',
    criteria: { read: 'no', dateMode: 'older', days: '14' },
    action: 'Flag the few that still matter, then select the rest, mark them as read and Archive.',
  },
  {
    id: 'iz-this-week-unread',
    title: 'Unread from the last 7 days',
    category: 'inbox-zero',
    criteria: { read: 'no', dateMode: 'within', days: '7' },
    action: 'Work through these first: they are recent enough to still need an answer.',
  },
  {
    id: 'large-messages',
    title: 'Large messages',
    category: 'cleanup',
    criteria: { sizeOp: '>', sizeMb: '10' },
    action: 'Sort by Size, largest first, then delete or save the attachments elsewhere to free up mailbox space.',
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
    title: 'Anything with an unsubscribe link',
    category: 'newsletters',
    criteria: { anyWords: 'unsubscribe "opt out" "email preferences" "manage preferences"' },
    note: 'Outlook search cannot read the hidden List-Unsubscribe header, so this matches the unsubscribe wording in the message itself, which is where footers put it.',
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
    criteria: { fileTypes: 'pdf' },
  },
  {
    id: 'office-attachments',
    title: 'Word, Excel and PowerPoint files',
    category: 'attachments',
    criteria: { fileTypes: 'word,excel,powerpoint' },
  },
  {
    id: 'file-share-links',
    title: 'File share links (OneDrive, SharePoint, Dropbox, Google Drive)',
    category: 'attachments',
    criteria: { anyWords: 'onedrive sharepoint dropbox "google drive" wetransfer "box.com" "1drv.ms" "shared a file" "shared a folder"' },
    note: 'Matches the service name or link text in the message. A link hidden behind other words, like "click here", may not be found.',
  },
  {
    id: 'attachments-this-week',
    title: 'Attachments received this week',
    category: 'attachments',
    criteria: { hasAttachments: 'yes', dateMode: 'preset', datePreset: 'this week' },
  },
  {
    id: 'meeting-links',
    title: 'Meeting links (Teams, Zoom, Google Meet, Webex)',
    category: 'meetings',
    criteria: { anyWords: '"Microsoft Teams meeting" "teams.microsoft.com" "zoom.us" "Zoom meeting" "meet.google.com" "Google Meet" webex gotomeeting' },
    note: 'Matches the join text that Teams, Zoom, Google Meet and Webex put in invitations. Invitations in your calendar are searched from the Calendar view, not Mail.',
  },
  {
    id: 'out-of-office',
    title: 'Out-of-office auto-replies',
    category: 'meetings',
    criteria: { subject: 'Automatic reply' },
  },
];

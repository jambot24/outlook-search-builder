# Outlook search syntax by client

This is the reference `js/query.js` is built from. Each cell says how we know it:
**D** is documented by Microsoft, **C** is reported by the community, **U** is unverified.
We compiled it from documentation on 2026-09-21. We have not yet tested the queries in a
live copy of each client.

**New Outlook for Windows, Outlook on the web and Outlook for Mac share one keyword table.**
Microsoft publishes the same table for Outlook on the web and for Mac. The generator treats
them as one engine, `modern`. Outlook Classic uses Instant Search (AQS), the `classic` engine.
Outlook mobile documents no keyword syntax, so it gets the modern query plus a plain-keyword
fallback.

| Criterion | Classic | New Outlook / web / Mac | Mobile |
|---|---|---|---|
| from: to: cc: bcc: | D | D | U |
| participants: | U. Expanded to from/to/cc | D | U |
| subject: | D | D | U |
| body: | U. Emitted with a warning | D | U |
| hasattachment:yes/no | D | D (singular spelling) | U |
| attachment:name | C | U. Emitted with a warning | U |
| received:/sent: relative words | D (today, yesterday, "this week", "last week", "last month", "last year") | D for today, yesterday, this week, last week. Others emitted with a warning | U |
| Single date | D, Windows regional format | D, MM/DD/YYYY | U |
| Date range | C, `>=` and `<=` | D, `date1..date2` | U |
| category: | D. Matches names that contain the word | D. Quote names with spaces | U |
| Unread | D, `read:no` | D for new Outlook for Windows (`read:no`). Not in the web/Mac table, so emitted with a warning | U |
| Flagged | D, `hasflag:true` | D, `isflagged:yes` | U |
| importance: | C | U. Emitted with a warning | U |
| messagesize: | D, `messagesize:>5 MB` | D for new Outlook for Windows, except the named sizes (tiny, small and so on). Not in the web/Mac table, so emitted with a warning | U |
| Exclude a word | D, `NOT word` (uppercase) | D, `-word` | U |
| OR | D (uppercase) | D | U |
| Folder | No keyword. Use the scope dropdown | No keyword. Use the folder pane or Folders filter | No keyword |

## Rules the generator follows

- **Terms are joined with an explicit `AND`.** Microsoft's Windows reference and its web/Mac
  table describe bare spaces differently, and `AND` means the same thing in both.

- **No space after a colon.** `from: jane` falls back to a full-text search on both engines.
- **Values with spaces are quoted.** `from:"Bob Smith"`, `category:"Trade Show"`.
- **Several values for one field are ORed in parentheses.** `(from:a OR from:b)`.
- **"Before" excludes the chosen day.** On the modern engine the range ends the day before.
- **Open-ended ranges use fixed bounds.** "On or after" becomes `date..12/31/2099` and
  "before" becomes `01/01/1990..date`, because the range syntax is documented and bare
  comparison operators are not.
- **Folders are not query text.** A chosen folder becomes an instruction to open that folder
  and set the scope to Current folder.

## Sources

Microsoft documentation:

- How to search in Outlook (classic and new Outlook for Windows):
  https://support.microsoft.com/en-us/office/how-to-search-in-outlook-d824d1e9-a255-4c8a-8553-276fb895a8da
- Search mail and people in Outlook on the web:
  https://support.microsoft.com/en-us/outlook/search-mail-and-people-in-outlook-on-the-web
- Search in Outlook for Mac:
  https://support.microsoft.com/en-us/office/search-in-outlook-for-mac-9c2e737e-050f-4125-addc-fa20fd03f291
- Find all messages with attachments:
  https://support.microsoft.com/en-us/office/find-all-messages-with-attachments-in-outlook-b1395e66-804f-4d05-99ef-0fbd9618fecf
- Find a message or item with Instant Search:
  https://support.microsoft.com/en-us/office/find-a-message-or-item-with-instant-search-69748862-5976-47b9-98e8-ed179f1b9e4d
- Search made simple in Outlook mobile:
  https://support.microsoft.com/en-us/office/search-made-simple-in-outlook-mobile-07df353b-e866-4c49-9d7c-dbbdf00a9223

Secondary sources:

- "Definitive Outlook Search Guide" (Perplexity, 2026-09-21). It cites the same Microsoft
  pages and was used to cross-check `read:`, `messagesize:`, explicit `AND` and the
  troubleshooting list on the page.

Community sources:

- Category names with spaces in new Outlook:
  https://learn.microsoft.com/en-za/answers/questions/5549845/how-to-search-for-emails-by-category-on-new-outloo
- No folder search in new Outlook:
  https://learn.microsoft.com/en-us/answers/questions/4708646/new-outlook-folder-path-search
- followupflag and importance in classic: https://www.ablebits.com/office-addins-blog/search-filter-emails-outlook/
- attachment: in classic: https://www.extendoffice.com/documents/outlook/1471-outlook-find-attachments-by-name.html

## Dates

Periods a client does not document are written out as a date range when the query is built,
and saved searches keep the period name so they recalculate. Classic documents today,
yesterday, this week, last week, last month and last year. The newer clients document today,
yesterday, this week and last week. "In the last N days" and "More than N days ago" are always
written as dates.

## Search folders

No Outlook version accepts typed search text in a search folder, so the tool maps each
criterion to a dialog field instead. We compiled this on 2026-09-21 and have not checked
it in a live client.

- **Outlook Classic:** Folder tab > New Search Folder > "Create a custom Search Folder".
  - The Criteria dialog has three tabs:
    - **Messages:** words, In, From, Sent To, Where I am, Time.
    - **More Choices:** categories, read or unread, attachments, importance, flag, size in KB.
    - **Advanced:** field, condition, value.
  - A custom folder covers one account or data file.
  - Custom folders do not appear in new Outlook or on the web.
  - Whether the words box treats several words as OR or honours quotes is not documented.
  - Source: https://support.microsoft.com/en-us/office/use-search-folders-to-find-messages-or-other-outlook-items-c1807038-01e4-475e-8869-0ccab0a56dc5
- **New Outlook and Outlook on the web:** only ready-made types are available.
  - The types are: Unread; Flagged; Unread or flagged; Important; Sent directly to me; From
    specific people; From and to specific people; Sent to public groups; Categorized; With
    attachments; Large; Old; With specific words.
  - Microsoft states that advanced custom search folders are supported only in classic Outlook.
  - "From specific people" needs full addresses and rejects domains (community report).
  - The tool picks the closest type and lists what it leaves out.
  - Source: https://support.microsoft.com/en-us/outlook/how-to-use-search-folders-on-outlook
- **Outlook for Mac:** search, add criteria in the filter panel, then Save Search.
  - The saved search appears under Saved Searches.
  - It stays on that Mac (community report).
  - Source: https://support.microsoft.com/en-us/outlook/save-a-search-by-using-a-smart-folder-in-outlook-for-mac
- **Outlook mobile:** there is no equivalent (community reports).

## Sort and columns

Search text cannot set sort order or columns in any client. Classic sets them through View
settings. The newer clients offer only sort options above the message list. Library entries
that benefit from a particular sort say so in their "Then" line.

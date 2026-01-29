# Email Code Retriever (PHP + Gmail IMAP)

This app searches a single authorized Gmail inbox (example: `servicehub000@gmail.com`)
and extracts verification codes from messages received in the last 5 minutes.

## Requirements

- PHP 8.1+
- PHP IMAP extension enabled

## Setup (IMAP + App Password)

1. Enable 2-Step Verification on the Gmail account.
2. Create an App Password (Google Account → Security → App passwords).
3. Copy `.env.example` to `.env` and fill in your credentials.
4. Set `AUTHORIZED_INBOX=servicehub000@gmail.com` in `.env` to lock access to that inbox.
5. Optionally set `LOOKBACK_MINUTES=500` to control how far back to search.
6. Set `LOCK_PASSWORDS=secret1,secret2` to protect flagged codes.
7. If you archive mail, set `IMAP_MAILBOX` to a mailbox from `tools/imap_list.php`.

## Run

```bash
php -S localhost:8000 -t public
```

Open `http://localhost:8000` after setting your IMAP credentials.

## How it works

- The app searches the Gmail inbox using IMAP.
- It filters to emails sent to the specified recipient address.
- It extracts 6-digit or 5-5 alphanumeric codes (within `LOOKBACK_MINUTES`).
- If a message contains “reset code” or has `background-color: #f3f3f3` in HTML, its codes are protected.

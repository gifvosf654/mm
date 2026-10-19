const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const nodemailer = require('nodemailer');

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { action, account, mailData } = req.body || {};

    // ১. ইমেইল সিঙ্ক করা (IMAP Fetch)
    if (action === 'sync') {
        const client = new ImapFlow({
            host: account.imap_host,
            port: Number(account.imap_port || 993),
            secure: true,
            auth: {
                user: account.email,
                pass: account.app_password
            },
            logger: false
        });

        try {
            await client.connect();
            let lock = await client.getMailboxLock('INBOX');
            const fetchedEmails = [];

            try {
                const totalMessages = client.mailbox.exists;
                if (totalMessages > 0) {
                    const startSeq = Math.max(1, totalMessages - 14); // সর্বশেষ ১৫টি মেইল আনবে
                    for await (let message of client.fetch(`${startSeq}:*`, { source: true, uid: true, flags: true })) {
                        const parsed = await simpleParser(message.source);
                        const fromObj = parsed.from?.value?.[0] || {};
                        const textContent = (parsed.text || '').trim();

                        fetchedEmails.push({
                            id: `${account.id}_${message.uid}`,
                            account_id: account.id,
                            account_email: account.email,
                            uid: message.uid,
                            subject: parsed.subject || '(No Subject)',
                            from_name: fromObj.name || fromObj.address || 'Unknown',
                            from_address: fromObj.address || '',
                            to_address: account.email,
                            date_ts: parsed.date ? new Date(parsed.date).getTime() : Date.now(),
                            snippet: textContent.slice(0, 160).replace(/\s+/g, ' '),
                            body_html: parsed.html || `<pre style="white-space:pre-wrap;font-family:sans-serif;">${textContent}</pre>`,
                            body_text: textContent,
                            is_read: message.flags.has('\\Seen'),
                            starred: message.flags.has('\\Flagged')
                        });
                    }
                }
            } finally {
                lock.release();
            }

            await client.logout();
            return res.status(200).json({ success: true, emails: fetchedEmails });
        } catch (err) {
            return res.status(500).json({ success: false, error: err.message });
        }
    }

    // ২. ইমেইল পাঠানো বা রিপ্লাই দেওয়া (SMTP Send)
    if (action === 'send') {
        try {
            const transporter = nodemailer.createTransport({
                host: account.smtp_host,
                port: Number(account.smtp_port || 465),
                secure: Number(account.smtp_port || 465) === 465,
                auth: {
                    user: account.email,
                    pass: account.app_password
                }
            });

            await transporter.sendMail({
                from: `"${account.label || account.email}" <${account.email}>`,
                to: mailData.to,
                subject: mailData.subject,
                text: mailData.body,
                html: `<div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:14px;line-height:1.6;">${mailData.body.replace(/\n/g, '<br>')}</div>`
            });

            return res.status(200).json({ success: true });
        } catch (err) {
            return res.status(500).json({ success: false, error: err.message });
        }
    }

    return res.status(400).json({ error: 'Invalid action' });
};

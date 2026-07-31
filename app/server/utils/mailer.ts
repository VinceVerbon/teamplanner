export interface OutgoingMail {
  to: string
  subject: string
  text: string
}

// In-memory capture used when no SMTP is configured (dev + tests).
export const sentMails: OutgoingMail[] = []

export async function sendMail(mail: OutgoingMail): Promise<void> {
  const host = process.env.SMTP_HOST
  if (!host) {
    sentMails.push(mail)
    console.log(`[mail:dev] to=${mail.to} subject="${mail.subject}"\n${mail.text}`)
    return
  }
  const { createTransport } = await import('nodemailer')
  const transporter = createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined
  })
  await transporter.sendMail({
    from: process.env.MAIL_FROM || 'teamplanner <noreply@localhost>',
    to: mail.to,
    subject: mail.subject,
    text: mail.text
  })
}

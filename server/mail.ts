import nodemailer, { type Transporter } from 'nodemailer';

/* Outgoing mail over plain SMTP, configured through environment variables so any provider works:
     SMTP_URL=smtps://user:pass@smtp.example.com:465           (or)
     SMTP_HOST, SMTP_PORT (587), SMTP_SECURE (true for 465), SMTP_USER, SMTP_PASS
     SMTP_FROM="UniHub <no-reply@example.com>"                  PUBLIC_URL=https://unihub.example.com
   Without SMTP the reset link is written to the server log instead, so a self-hosting admin can pass it on. */
export const mailConfigured = () => !!(process.env.SMTP_URL || process.env.SMTP_HOST);
export const publicUrl = () => (process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 8787}`).replace(/\/+$/, '');

let transport: Transporter | null = null;
function getTransport(): Transporter {
  if (transport) return transport;
  transport = process.env.SMTP_URL
    ? nodemailer.createTransport(process.env.SMTP_URL)
    : nodemailer.createTransport({
      host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT ?? 587), secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      tls: { rejectUnauthorized: process.env.SMTP_INSECURE_TLS !== 'true' },
    });
  return transport;
}

export async function sendMail(to: string, subject: string, text: string): Promise<void> {
  await getTransport().sendMail({ from: process.env.SMTP_FROM ?? 'UniHub <no-reply@localhost>', to, subject, text });
}

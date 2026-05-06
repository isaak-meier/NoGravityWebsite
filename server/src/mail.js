/**
 * @typedef {{ to: string, subject: string, html?: string, text?: string }} MailMessage
 * @typedef {{ send: (msg: MailMessage) => Promise<{ id: string | null }> }} MailSender
 */

/**
 * Build a MailSender from config.mail. In dev (transport=noop) emails are
 * captured to an in-memory log and printed; in prod (transport=resend) they go
 * through the Resend SDK.
 *
 * @param {{ transport: string, resendApiKey: string | null, from: string }} mailConfig
 * @param {{ logger?: { info: Function, warn: Function, error: Function } }} [opts]
 * @returns {MailSender & { sent?: MailMessage[] }}
 */
export function createMailSender(mailConfig, opts = {}) {
  const log = opts.logger || console;
  if (mailConfig.transport === "resend") {
    if (!mailConfig.resendApiKey) {
      throw new Error("MAIL_TRANSPORT=resend but RESEND_API_KEY is not set");
    }
    return createResendSender(mailConfig, log);
  }
  return createNoopSender(mailConfig, log);
}

function createNoopSender(mailConfig, log) {
  const sent = [];
  return {
    sent,
    async send(msg) {
      sent.push(msg);
      log.info(
        { to: msg.to, subject: msg.subject, from: mailConfig.from },
        "[mail/noop] would send",
      );
      if (msg.text) log.info({ text: msg.text }, "[mail/noop] text body");
      return { id: null };
    },
  };
}

function createResendSender(mailConfig, log) {
  let clientPromise = null;
  async function getClient() {
    if (!clientPromise) {
      clientPromise = import("resend").then(
        ({ Resend }) => new Resend(mailConfig.resendApiKey),
      );
    }
    return clientPromise;
  }
  return {
    async send(msg) {
      const client = await getClient();
      const { data, error } = await client.emails.send({
        from: mailConfig.from,
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      });
      if (error) {
        log.error({ err: error, to: msg.to }, "[mail/resend] send failed");
        throw new Error(`Resend send failed: ${error.message || error.name}`);
      }
      return { id: data?.id || null };
    },
  };
}

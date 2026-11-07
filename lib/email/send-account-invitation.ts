import "server-only";
import { randomBytes, createHash } from "node:crypto";
import nodemailer from "nodemailer";

export function makeTemporaryPassword() {
  return randomBytes(24).toString("base64url");
}
export function makeInvitationToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: createHash("sha256").update(token).digest("hex") };
}

/** Gmail SMTP is the preferred Branchline sender; Resend remains an optional fallback. */
export function isEmailConfigured() {
  const gmailReady = Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
  const resendReady = Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL);
  return gmailReady || resendReady;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c] ?? c);
}

async function deliverEmail(input: { to: string; subject: string; text: string; html: string }) {
  const gmailUser = process.env.GMAIL_USER?.trim();
  const gmailPassword = process.env.GMAIL_APP_PASSWORD?.replace(/\s+/g, "");
  if (gmailUser && gmailPassword) {
    const transport = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: gmailUser, pass: gmailPassword },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
    });
    try {
      const result = await transport.sendMail({
        from: `Branchline <${gmailUser}>`,
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: input.html,
      });
      if (!result.messageId || result.rejected.length) throw new Error("EMAIL_DELIVERY_FAILED");
      return result.messageId;
    } catch {
      throw new Error("EMAIL_DELIVERY_FAILED");
    } finally {
      transport.close();
    }
  }

  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!key || !from) throw new Error("EMAIL_PROVIDER_NOT_CONFIGURED");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "User-Agent": "Branchline-PTG/1.0",
    },
    body: JSON.stringify({ from, to: [input.to], subject: input.subject, text: input.text, html: input.html }),
  });
  if (!response.ok) throw new Error("EMAIL_DELIVERY_FAILED");
  const result = await response.json() as { id?: string };
  if (!result.id) throw new Error("EMAIL_DELIVERY_FAILED");
  return result.id;
}

export async function sendAccountInvitation(input: {
  email: string; displayName: string; username: string; temporaryPassword: string; acceptUrl: string;
}) {
  const name = escapeHtml(input.displayName);
  const username = escapeHtml(input.username);
  const password = escapeHtml(input.temporaryPassword);
  const acceptUrl = escapeHtml(input.acceptUrl);
  const appUrl = new URL("/login", input.acceptUrl).toString();
  const installUrl = new URL("/install", input.acceptUrl).toString();
  const text = `Hello ${input.displayName},

Your Branchline Price Tag Generator account has been created.

Username: ${input.username}
Temporary password: ${input.temporaryPassword}

Accept your invitation: ${input.acceptUrl}

After accepting, sign in with your username and temporary password. You must set a new password before accessing PTG.

Open Branchline PTG: ${appUrl}
Install Branchline PTG: ${installUrl}

This invitation expires in 48 hours. If you were not expecting this email, contact your Branchline administrator.`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#172033;line-height:1.6"><h2 style="color:#385ff0">BRANCHLINE.</h2><h3>Price Tag Generator</h3><p>Hello ${name}, your account has been created.</p><p><b>Username:</b> ${username}<br><b>Temporary password:</b> <code>${password}</code></p><p><a href="${acceptUrl}" style="display:inline-block;padding:12px 18px;background:#385ff0;color:#fff;text-decoration:none;border-radius:6px">Accept invitation</a></p><p>After accepting, sign in with your username and temporary password. You must create a new password before accessing PTG.</p><p><a href="${escapeHtml(appUrl)}">Open Branchline PTG</a> · <a href="${escapeHtml(installUrl)}">Install the app</a></p><p>This invitation expires in 48 hours. If you were not expecting it, contact your Branchline administrator.</p></div>`;
  return deliverEmail({ to: input.email, subject: "Your Branchline PTG account invitation", text, html });
}

export async function sendPasswordResetEmail(input: {
  email: string; displayName: string; username: string; temporaryPassword: string; loginUrl: string;
}) {
  const installUrl = new URL("/install", input.loginUrl).toString();
  const name = escapeHtml(input.displayName);
  const username = escapeHtml(input.username);
  const password = escapeHtml(input.temporaryPassword);
  const loginUrl = escapeHtml(input.loginUrl);
  const install = escapeHtml(installUrl);
  const text = `Hello ${input.displayName},

Your Branchline PTG password has been reset.
Username: ${input.username}
Temporary password: ${input.temporaryPassword}

Sign in at ${input.loginUrl}. You must change this temporary password before using the application.
Install Branchline PTG: ${installUrl}

If you did not request this, contact your System Admin immediately.`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#172033;line-height:1.6"><h2 style="color:#385ff0">BRANCHLINE.</h2><h3>Price Tag Generator · Password reset</h3><p>Hello ${name}, your password has been reset.</p><p><b>Username:</b> ${username}<br><b>Temporary password:</b> <code>${password}</code></p><p><a href="${loginUrl}">Sign in to Branchline PTG</a></p><p><a href="${install}">Install Branchline PTG</a></p><p>You must change this temporary password before using the application. If you did not request this, contact your System Admin immediately.</p></div>`;
  return deliverEmail({ to: input.email, subject: "Your Branchline PTG temporary password", text, html });
}

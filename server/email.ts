import nodemailer from "nodemailer";

export type EmailTheme = "navy-orange" | "green-black" | "blue-white" | "black-gold" | "red-white" | "purple-white" | "teal-white" | "white-gray" | "black-white";

interface ThemeColors {
  headerBg: string;
  headerText: string;
  badgeBg: string;
  badgeBorder: string;
  badgeText: string;
  ctaBg: string;
  ctaShadow: string;
  bodyBg: string;
  headingColor: string;
  fallbackLogoBg: string;
  accentColor: string;
}

const themes: Record<EmailTheme, ThemeColors> = {
  "navy-orange": {
    headerBg: "linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)",
    headerText: "#ffffff",
    badgeBg: "rgba(249,115,22,0.2)",
    badgeBorder: "rgba(249,115,22,0.4)",
    badgeText: "#FB923C",
    ctaBg: "linear-gradient(135deg, #F97316, #FB923C)",
    ctaShadow: "rgba(249,115,22,0.35)",
    bodyBg: "#f4f1ec",
    headingColor: "#1a1a2e",
    fallbackLogoBg: "linear-gradient(135deg, #F97316, #FB923C)",
    accentColor: "#F97316",
  },
  "green-black": {
    headerBg: "linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 50%, #0d1f0d 100%)",
    headerText: "#ffffff",
    badgeBg: "rgba(34,197,94,0.2)",
    badgeBorder: "rgba(34,197,94,0.4)",
    badgeText: "#22c55e",
    ctaBg: "linear-gradient(135deg, #16a34a, #22c55e)",
    ctaShadow: "rgba(34,197,94,0.35)",
    bodyBg: "#f0fdf4",
    headingColor: "#0a0a0a",
    fallbackLogoBg: "linear-gradient(135deg, #16a34a, #22c55e)",
    accentColor: "#16a34a",
  },
  "blue-white": {
    headerBg: "linear-gradient(135deg, #1e40af 0%, #2563eb 50%, #3b82f6 100%)",
    headerText: "#ffffff",
    badgeBg: "rgba(59,130,246,0.15)",
    badgeBorder: "rgba(59,130,246,0.3)",
    badgeText: "#60a5fa",
    ctaBg: "linear-gradient(135deg, #2563eb, #3b82f6)",
    ctaShadow: "rgba(37,99,235,0.35)",
    bodyBg: "#eff6ff",
    headingColor: "#1e3a5f",
    fallbackLogoBg: "linear-gradient(135deg, #2563eb, #3b82f6)",
    accentColor: "#2563eb",
  },
  "black-gold": {
    headerBg: "linear-gradient(135deg, #0a0a0a 0%, #1c1c1c 50%, #2a2a2a 100%)",
    headerText: "#ffffff",
    badgeBg: "rgba(234,179,8,0.2)",
    badgeBorder: "rgba(234,179,8,0.4)",
    badgeText: "#fbbf24",
    ctaBg: "linear-gradient(135deg, #ca8a04, #eab308)",
    ctaShadow: "rgba(234,179,8,0.35)",
    bodyBg: "#fefce8",
    headingColor: "#1a1a1a",
    fallbackLogoBg: "linear-gradient(135deg, #ca8a04, #eab308)",
    accentColor: "#ca8a04",
  },
  "red-white": {
    headerBg: "linear-gradient(135deg, #991b1b 0%, #dc2626 50%, #ef4444 100%)",
    headerText: "#ffffff",
    badgeBg: "rgba(239,68,68,0.15)",
    badgeBorder: "rgba(239,68,68,0.3)",
    badgeText: "#f87171",
    ctaBg: "linear-gradient(135deg, #dc2626, #ef4444)",
    ctaShadow: "rgba(220,38,38,0.35)",
    bodyBg: "#fef2f2",
    headingColor: "#7f1d1d",
    fallbackLogoBg: "linear-gradient(135deg, #dc2626, #ef4444)",
    accentColor: "#dc2626",
  },
  "purple-white": {
    headerBg: "linear-gradient(135deg, #581c87 0%, #7c3aed 50%, #8b5cf6 100%)",
    headerText: "#ffffff",
    badgeBg: "rgba(139,92,246,0.15)",
    badgeBorder: "rgba(139,92,246,0.3)",
    badgeText: "#a78bfa",
    ctaBg: "linear-gradient(135deg, #7c3aed, #8b5cf6)",
    ctaShadow: "rgba(124,58,237,0.35)",
    bodyBg: "#faf5ff",
    headingColor: "#3b0764",
    fallbackLogoBg: "linear-gradient(135deg, #7c3aed, #8b5cf6)",
    accentColor: "#7c3aed",
  },
  "teal-white": {
    headerBg: "linear-gradient(135deg, #134e4a 0%, #0d9488 50%, #14b8a6 100%)",
    headerText: "#ffffff",
    badgeBg: "rgba(20,184,166,0.15)",
    badgeBorder: "rgba(20,184,166,0.3)",
    badgeText: "#2dd4bf",
    ctaBg: "linear-gradient(135deg, #0d9488, #14b8a6)",
    ctaShadow: "rgba(13,148,136,0.35)",
    bodyBg: "#f0fdfa",
    headingColor: "#134e4a",
    fallbackLogoBg: "linear-gradient(135deg, #0d9488, #14b8a6)",
    accentColor: "#0d9488",
  },
  "white-gray": {
    headerBg: "linear-gradient(135deg, #f8f9fa 0%, #e9ecef 50%, #dee2e6 100%)",
    headerText: "#111827",
    badgeBg: "rgba(107,114,128,0.12)",
    badgeBorder: "rgba(107,114,128,0.3)",
    badgeText: "#4b5563",
    ctaBg: "linear-gradient(135deg, #374151, #4b5563)",
    ctaShadow: "rgba(55,65,81,0.3)",
    bodyBg: "#ffffff",
    headingColor: "#111827",
    fallbackLogoBg: "linear-gradient(135deg, #374151, #4b5563)",
    accentColor: "#374151",
  },
  "black-white": {
    headerBg: "linear-gradient(135deg, #000000 0%, #111111 50%, #1a1a1a 100%)",
    headerText: "#ffffff",
    badgeBg: "rgba(255,255,255,0.1)",
    badgeBorder: "rgba(255,255,255,0.2)",
    badgeText: "#d1d5db",
    ctaBg: "linear-gradient(135deg, #000000, #333333)",
    ctaShadow: "rgba(0,0,0,0.35)",
    bodyBg: "#fafafa",
    headingColor: "#000000",
    fallbackLogoBg: "linear-gradient(135deg, #000000, #333333)",
    accentColor: "#000000",
  },
};

function getTheme(themeName?: string): ThemeColors {
  return themes[(themeName || "navy-orange") as EmailTheme] || themes["navy-orange"];
}

function createTransporter(useBackup = false) {
  const email = useBackup ? process.env.SMTP_EMAIL_BACKUP : process.env.SMTP_EMAIL;
  const pass = useBackup ? process.env.SMTP_APP_PASSWORD_BACKUP : process.env.SMTP_APP_PASSWORD;
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: email, pass },
  });
}

function getFromEmail(useBackup = false) {
  return useBackup ? process.env.SMTP_EMAIL_BACKUP : process.env.SMTP_EMAIL;
}

function swapFromEmail(mailOptions: any, newEmail: string) {
  if (mailOptions.from && typeof mailOptions.from === "string" && mailOptions.from.includes("<")) {
    mailOptions.from = mailOptions.from.replace(/<[^>]+>/, `<${newEmail}>`);
  } else {
    mailOptions.from = `"ConstructHUB" <${newEmail}>`;
  }
}

export async function trySend(useBackup: boolean, mailOptions: any, replyToSelf: boolean = false): Promise<{ accepted: string[]; rejected: string[]; response: string }> {
  const transporter = createTransporter(useBackup);
  const fromEmail = getFromEmail(useBackup)!;
  const label = useBackup ? "BACKUP" : "PRIMARY";

  await transporter.verify();
  console.log(`[SMTP ${label}] Connection verified (${fromEmail})`);

  swapFromEmail(mailOptions, fromEmail);
  if (replyToSelf) mailOptions.replyTo = fromEmail;

  const info = await transporter.sendMail(mailOptions);

  const accepted = Array.isArray(info.accepted) ? info.accepted.map(String) : [];
  const rejected = Array.isArray(info.rejected) ? info.rejected.map(String) : [];

  if (rejected.length > 0) {
    console.warn(`[SMTP ${label}] Some recipients rejected: ${rejected.join(", ")}`);
  }

  if (accepted.length === 0 && mailOptions.to) {
    throw new Error(`No recipients accepted by ${label} SMTP`);
  }

  console.log(`[SMTP ${label}] Delivered to ${accepted.join(", ")} | Response: ${info.response}`);
  return { accepted, rejected, response: info.response };
}

export async function sendWithFallback(mailOptions: any, replyToSelf = false) {
  try {
    return await trySend(false, { ...mailOptions }, replyToSelf);
  } catch (primaryErr: any) {
    console.error(`[SMTP PRIMARY] Failed: ${primaryErr.message}`);

    if (!process.env.SMTP_EMAIL_BACKUP || !process.env.SMTP_APP_PASSWORD_BACKUP) {
      console.error("[SMTP] No backup credentials configured — cannot failover");
      throw primaryErr;
    }

    console.log("[SMTP] Switching to BACKUP...");
    try {
      const result = await trySend(true, { ...mailOptions }, replyToSelf);
      console.log("[SMTP BACKUP] Delivery confirmed");
      return result;
    } catch (backupErr: any) {
      console.error(`[SMTP BACKUP] Also failed: ${backupErr.message}`);
      throw new Error(`Both SMTP accounts failed. Primary: ${primaryErr.message} | Backup: ${backupErr.message}`);
    }
  }
}

function getLogoHtml(companyLogoUrl: string | null, companyName: string, baseUrl: string): string {
  const absoluteLogoUrl = companyLogoUrl
    ? (companyLogoUrl.startsWith("http") ? companyLogoUrl : `${baseUrl}${companyLogoUrl}`)
    : null;

  const chubLogoUrl = `${baseUrl}/chub-logo-square-text.png`;

  const companyLogo = absoluteLogoUrl
    ? `<img src="${absoluteLogoUrl}" alt="${companyName}" style="width: 72px; height: 72px; border-radius: 16px; object-fit: cover; border: 3px solid #f0f0f0;" />`
    : `<div style="width: 72px; height: 72px; border-radius: 16px; background: linear-gradient(135deg, #F97316, #FB923C); display: flex; align-items: center; justify-content: center; margin: 0 auto;"><span style="color: white; font-size: 28px; font-weight: 800;">${companyName.charAt(0)}</span></div>`;

  return `
    <div style="text-align: center; padding: 32px 0 24px;">
      <table cellpadding="0" cellspacing="0" style="margin: 0 auto;">
        <tr>
          <td style="text-align: center; padding-bottom: 16px;">
            ${companyLogo}
          </td>
        </tr>
        <tr>
          <td style="text-align: center;">
            <h1 style="color: #1a1a2e; font-size: 26px; margin: 0; font-weight: 800; letter-spacing: -0.5px;">${companyName}</h1>
          </td>
        </tr>
      </table>
    </div>
  `;
}

function getFooterHtml(companyName: string, baseUrl: string, unsubscribeUrl: string | null, accentColor: string = "#F97316"): string {
  const chubLogoUrl = `${baseUrl}/chub-logo-square-text.png`;
  const unsubscribeLink = unsubscribeUrl
    ? `<a href="${unsubscribeUrl}" style="color: #999; font-size: 11px; text-decoration: underline;">Unsubscribe from future emails</a>`
    : "";

  return `
    <div style="margin-top: 32px; padding-top: 24px; border-top: 2px solid #f0f0f0;">
      <table cellpadding="0" cellspacing="0" style="margin: 0 auto;">
        <tr>
          <td style="text-align: center; padding-bottom: 12px;">
            <img src="${chubLogoUrl}" alt="ConstructHUB" style="width: 40px; height: 40px; border-radius: 8px;" />
          </td>
        </tr>
        <tr>
          <td style="text-align: center;">
            <p style="margin: 0; font-size: 11px; color: #aaa; line-height: 1.6;">
              Sent by <strong style="color: #888;">${companyName}</strong> via <strong style="color: ${accentColor};">ConstructHUB</strong>
            </p>
            <p style="margin: 6px 0 0; font-size: 11px; color: #bbb;">
              If you believe this was sent in error, please disregard this email.
            </p>
            ${unsubscribeLink ? `<p style="margin: 10px 0 0;">${unsubscribeLink}</p>` : ""}
          </td>
        </tr>
      </table>
    </div>
  `;
}

export async function sendVerificationEmail(to: string, token: string, baseUrl: string) {
  const verifyUrl = `${baseUrl}/api/auth/verify-email?token=${token}`;

  await sendWithFallback({
    from: `"ConstructHUB" <${process.env.SMTP_EMAIL}>`,
    to,
    subject: "Verify your email — ConstructHUB",
    html: `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px; background: #ffffff;">
        <div style="text-align: center; margin-bottom: 24px;">
          <img src="${baseUrl}/chub-logo-square-text.png" alt="ConstructHUB" style="width: 60px; height: 60px; border-radius: 12px;" />
          <h1 style="color: #F97316; font-size: 24px; margin: 12px 0 0;">ConstructHUB</h1>
          <p style="color: #666; font-size: 13px; margin-top: 4px;">Contractor Services Platform</p>
        </div>
        <h2 style="font-size: 18px; color: #1a1a2e;">Verify your email</h2>
        <p style="color: #444; line-height: 1.6;">Click the button below to verify your email address and activate your account.</p>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${verifyUrl}" style="background: linear-gradient(135deg, #F97316, #FB923C); color: white; padding: 14px 36px; border-radius: 8px; text-decoration: none; font-weight: bold; display: inline-block; font-size: 15px;">Verify Email</a>
        </div>
        <p style="color: #888; font-size: 12px;">This link expires in 24 hours. If you didn't create an account, you can ignore this email.</p>
      </div>
    `,
  });
}

export async function sendContractEmail(to: string, token: string, packageName: string, monthlyPrice: number, baseUrl: string) {
  const signUrl = `${baseUrl}/contract/sign/${token}`;
  const priceStr = (monthlyPrice / 100).toLocaleString();

  await sendWithFallback({
    from: `"ConstructHUB Legal" <${process.env.SMTP_EMAIL}>`,
    to,
    subject: `Action Required: SEO Service Agreement — ${packageName} | ConstructHUB`,
    priority: "high",
    headers: {
      "X-Priority": "1",
      "X-MSMail-Priority": "High",
      "Importance": "High",
    },
    html: `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 32px; background: #ffffff;">
        <div style="text-align: center; margin-bottom: 24px; border-bottom: 3px solid #1a1a2e; padding-bottom: 20px;">
          <img src="${baseUrl}/chub-logo-square-text.png" alt="ConstructHUB" style="width: 50px; height: 50px; border-radius: 10px; margin-bottom: 8px;" />
          <h1 style="color: #1a1a2e; font-size: 26px; margin: 0; letter-spacing: -0.5px;">ConstructHUB</h1>
          <p style="color: #888; font-size: 12px; margin-top: 4px; text-transform: uppercase; letter-spacing: 2px;">SEO Services Division</p>
        </div>

        <div style="background: #f8f9fa; border-left: 4px solid #F97316; padding: 16px 20px; margin-bottom: 24px; border-radius: 0 6px 6px 0;">
          <p style="margin: 0; font-size: 14px; color: #444;">
            <strong style="color: #1a1a2e;">Contract Signature Required</strong><br/>
            Your <strong>${packageName}</strong> service agreement ($${priceStr}/mo) is ready for review and signature.
          </p>
        </div>

        <h2 style="font-size: 18px; color: #1a1a2e; margin-bottom: 8px;">Review & Sign Your Agreement</h2>
        <p style="color: #444; line-height: 1.7; font-size: 14px;">
          Before we can begin your SEO campaign, you must review and digitally sign the service agreement. This contract outlines the scope of work, payment terms, minimum commitment period, and all applicable terms and conditions.
        </p>

        <p style="color: #444; line-height: 1.7; font-size: 14px;">
          <strong>Important:</strong> Your card will not be charged until this contract is signed. The agreement link expires in 72 hours.
        </p>

        <div style="text-align: center; margin: 32px 0;">
          <a href="${signUrl}" style="background: linear-gradient(135deg, #F97316, #FB923C); color: white; padding: 14px 40px; border-radius: 8px; text-decoration: none; font-weight: bold; display: inline-block; font-size: 16px; box-shadow: 0 4px 12px rgba(249,115,22,0.3);">Review & Sign Contract</a>
        </div>

        <div style="background: #fff3e0; padding: 12px 16px; border-radius: 6px; margin-bottom: 24px;">
          <p style="margin: 0; font-size: 12px; color: #e65100;">
            This is a binding legal agreement. Please read all terms carefully before signing. By signing, you agree to the minimum term commitment and all payment obligations.
          </p>
        </div>

        <p style="color: #888; font-size: 11px; border-top: 1px solid #eee; padding-top: 16px; line-height: 1.6;">
          This email was sent to ${to} regarding an SEO service agreement with ConstructHUB. If you did not request this contract, please disregard this email. For questions, reply to this email or contact support@constructhub.us.
        </p>
      </div>
    `,
  });
}

export async function sendReviewRequestEmail(to: string, clientName: string, companyName: string, companyLogoUrl: string | null, token: string, baseUrl: string, themeName?: string, personalMessage?: string, bccEmail?: string) {
  const feedbackUrl = `${baseUrl}/api/review/${token}/click`;
  const theme = getTheme(themeName);

  const bodyText = personalMessage
    ? personalMessage
    : `Thank you for choosing ${companyName} for your recent project. We genuinely care about your experience and would really appreciate your honest feedback.\n\nIt only takes a minute and your response is completely private. It helps us keep improving our work for customers like you.`;

  const bodyHtml = personalMessage
    ? personalMessage.split("\n").map(line => `<p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 12px;">${line || "&nbsp;"}</p>`).join("")
    : `<p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 12px;">Thank you for choosing ${companyName} for your recent project. We genuinely care about your experience and would really appreciate your honest feedback.</p>
<p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 24px;">It only takes a minute and your response is completely private. It helps us keep improving our work for customers like you.</p>`;

  const mailOptions: any = {
    from: `"${companyName}" <${process.env.SMTP_EMAIL}>`,
    replyTo: process.env.SMTP_EMAIL,
    to,
    subject: `${clientName}, how did your project go?`,
    headers: {
      "X-Priority": "3",
      "Importance": "Normal",
    },
    text: `Hi ${clientName},\n\n${bodyText}\n\n${feedbackUrl}\n\nThank you,\n${companyName}`,
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body style="margin:0;padding:0;font-family:'Segoe UI','Helvetica Neue',Arial,sans-serif;">
<div style="max-width:560px;margin:0 auto;padding:32px 16px;">
<p style="color:#111827;font-size:15px;line-height:1.7;margin:0 0 16px;">Hi ${clientName},</p>
${bodyHtml}
<p style="margin:0 0 24px;"><a href="${feedbackUrl}" style="background-color:${theme.accentColor};color:#ffffff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block;font-size:14px;">Share Your Feedback</a></p>
<p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 4px;">Thank you,</p>
<p style="color:#111827;font-size:15px;line-height:1.7;margin:0;font-weight:600;">${companyName}</p>
</div></body></html>`,
  };
  if (bccEmail) {
    mailOptions.bcc = bccEmail;
  }
  await sendWithFallback(mailOptions, true);
}

export async function sendReviewReminderEmail(to: string, clientName: string, companyName: string, companyLogoUrl: string | null, token: string, baseUrl: string, reminderNumber: number, themeName?: string, bccEmail?: string) {
  const feedbackUrl = `${baseUrl}/api/review/${token}/click`;
  const unsubscribeUrl = `${baseUrl}/review/${token}/unsubscribe`;
  const theme = getTheme(themeName);

  const subjects = [
    `${clientName}, just checking in`,
    `${clientName}, we'd still love your feedback`,
    `${clientName}, one last ask from ${companyName}`,
  ];
  const subject = subjects[Math.min(reminderNumber - 1, subjects.length - 1)];

  const bodyMessages = [
    `We reached out recently asking about your experience and haven't heard back yet. We completely understand you're busy — just wanted to make sure the link didn't get lost.`,
    `We know life gets busy, so this is just a gentle nudge. We'd really value hearing how your project went — your honest feedback helps us do better work for future customers.`,
    `This is our last follow-up. We don't want to be a bother, but your opinion genuinely matters to us. If you have a minute, we'd love to hear from you.`,
  ];
  const bodyMessage = bodyMessages[Math.min(reminderNumber - 1, bodyMessages.length - 1)];

  const unsubText = `\n\nUnsubscribe: ${unsubscribeUrl}`;
  const unsubHtml = `<p style="margin:24px 0 0;text-align:center;"><a href="${unsubscribeUrl}" style="color:#d1d5db;font-size:10px;text-decoration:none;">Unsubscribe</a></p>`;

  const headers: Record<string, string> = {
    "X-Priority": "3",
    "Importance": "Normal",
    "List-Unsubscribe": `<${unsubscribeUrl}>`,
  };

  const reminderMailOptions: any = {
    from: `"${companyName}" <${process.env.SMTP_EMAIL}>`,
    replyTo: process.env.SMTP_EMAIL,
    to,
    subject,
    headers,
    text: `Hi ${clientName},\n\n${bodyMessage}\n\nShare your feedback here:\n${feedbackUrl}\n\nThank you,\n${companyName}${unsubText}`,
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body style="margin:0;padding:0;font-family:'Segoe UI','Helvetica Neue',Arial,sans-serif;">
<div style="max-width:560px;margin:0 auto;padding:32px 16px;">
<p style="color:#111827;font-size:15px;line-height:1.7;margin:0 0 16px;">Hi ${clientName},</p>
<p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 24px;">${bodyMessage}</p>
<p style="margin:0 0 24px;"><a href="${feedbackUrl}" style="background-color:${theme.accentColor};color:#ffffff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block;font-size:14px;">Share Your Feedback</a></p>
<p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 4px;">Thank you,</p>
<p style="color:#111827;font-size:15px;line-height:1.7;margin:0;font-weight:600;">${companyName}</p>
${unsubHtml}
</div></body></html>`,
  };
  if (bccEmail) {
    reminderMailOptions.bcc = bccEmail;
  }
  await sendWithFallback(reminderMailOptions, true);
}

export async function sendTrialInviteEmail(to: string, recipientName: string, code: string, trialDays: number, baseUrl: string) {
  const settingsUrl = `${baseUrl}/settings`;
  const isUnlimited = trialDays <= 0;
  const durationText = isUnlimited ? "unlimited" : `${trialDays}-day`;

  await sendWithFallback({
    from: `"ConstructHUB" <${process.env.SMTP_EMAIL}>`,
    to,
    subject: `You've been invited to try ConstructHUB — ${durationText} free trial`,
    headers: {
      "X-Priority": "3",
      "Importance": "Normal",
    },
    text: `Hi ${recipientName},\n\nYou've been invited to try ConstructHUB with ${isUnlimited ? "an unlimited free trial" : `a ${trialDays}-day free trial`} of our full Platinum plan.\n\nYour trial code: ${code}\n\nTo activate:\n1. Sign up or log in at ${baseUrl}\n2. Go to Settings > Account\n3. Enter your code: ${code}\n\nThis gives you full access to all 15+ tools including permit search, Google Business tools, Click Guard, IP Tracker, and more.\n\nThank you,\nConstructHUB Team`,
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body style="margin:0;padding:0;font-family:'Segoe UI','Helvetica Neue',Arial,sans-serif;">
<div style="max-width:560px;margin:0 auto;padding:32px 16px;">
<p style="color:#111827;font-size:15px;line-height:1.7;margin:0 0 16px;">Hi ${recipientName},</p>
<p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 12px;">You've been invited to try <strong>ConstructHUB</strong> with ${isUnlimited ? `<strong>unlimited free access</strong>` : `a <strong>${trialDays}-day free trial</strong>`} to our full Platinum plan.</p>
<p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 16px;">Your trial code:</p>
<div style="background:#f3f4f6;border:2px dashed #d1d5db;border-radius:8px;padding:16px;text-align:center;margin:0 0 20px;">
<code style="font-size:20px;font-weight:700;letter-spacing:2px;color:#111827;">${code}</code>
</div>
<p style="color:#374151;font-size:14px;line-height:1.7;margin:0 0 8px;font-weight:600;">To activate:</p>
<ol style="color:#374151;font-size:14px;line-height:2;margin:0 0 20px;padding-left:20px;">
<li>Sign up or log in at <a href="${baseUrl}" style="color:#F97316;text-decoration:none;font-weight:600;">constructhub.us</a></li>
<li>Go to Settings → Account</li>
<li>Enter your code above</li>
</ol>
<p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 24px;">This gives you full access to all 15+ tools including permit search, Google Business tools, Click Guard, IP Tracker, and more.</p>
<p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 4px;">Thank you,</p>
<p style="color:#111827;font-size:15px;line-height:1.7;margin:0;font-weight:600;">ConstructHUB Team</p>
</div></body></html>`,
  });
}

// ── LSA admin alerts ─────────────────────────────────────────────────────────
// Operational alerts for the admin team when something happens inside the LSA
// Account Manager (a new charged lead arrives, or a campaign is paused). These
// always go to the fixed admin distribution list, never to end users.
const LSA_ALERT_RECIPIENTS = ["alpinesidingcompany@gmail.com", "support@constructhub.us"];
const LSA_BASE_URL = process.env.LSA_PUBLIC_BASE_URL || "https://constructhub.us";

function lsaAlertShell(title: string, accent: string, rows: Array<[string, string]>, ctaText: string, ctaUrl: string): string {
  const rowsHtml = rows
    .map(([label, value]) => `<tr>
<td style="padding:6px 0;color:#6b7280;font-size:13px;width:140px;vertical-align:top;">${label}</td>
<td style="padding:6px 0;color:#111827;font-size:14px;font-weight:600;">${value}</td>
</tr>`)
    .join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body style="margin:0;padding:0;font-family:'Segoe UI','Helvetica Neue',Arial,sans-serif;background:#f9fafb;">
<div style="max-width:560px;margin:0 auto;padding:32px 16px;">
<div style="text-align:center;margin-bottom:20px;">
<img src="${LSA_BASE_URL}/chub-logo-square-text.png" alt="ConstructHUB" style="width:52px;height:52px;border-radius:10px;" />
</div>
<div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
<div style="background:${accent};padding:16px 24px;">
<h1 style="color:#ffffff;font-size:17px;margin:0;">${title}</h1>
</div>
<div style="padding:20px 24px;">
<table style="width:100%;border-collapse:collapse;">${rowsHtml}</table>
<div style="text-align:center;margin:24px 0 4px;">
<a href="${ctaUrl}" style="background:${accent};color:#ffffff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;font-size:14px;">${ctaText}</a>
</div>
</div>
</div>
<p style="color:#9ca3af;font-size:11px;text-align:center;margin:16px 0 0;">Automated alert from the ConstructHUB LSA Account Manager.</p>
</div></body></html>`;
}

export async function sendLsaChargedLeadAlert(data: {
  accountName: string | null;
  customerId: string;
  customerName: string | null;
  customerPhone: string | null;
  serviceRequested: string | null;
  leadType: string | null;
}) {
  const accountLabel = data.accountName || data.customerId;
  const ctaUrl = `${LSA_BASE_URL}/lsa-account-manager`;
  const rows: Array<[string, string]> = [
    ["Account", accountLabel],
    ["Customer", data.customerName || "Unknown"],
    ["Phone", data.customerPhone || "—"],
    ["Service", data.serviceRequested || "—"],
    ["Lead type", data.leadType || "—"],
  ];
  const text = `New charged LSA lead\n\nAccount: ${accountLabel}\nCustomer: ${data.customerName || "Unknown"}\nPhone: ${data.customerPhone || "—"}\nService: ${data.serviceRequested || "—"}\nLead type: ${data.leadType || "—"}\n\nReview it: ${ctaUrl}`;
  await sendWithFallback({
    from: `"ConstructHUB LSA" <${process.env.SMTP_EMAIL}>`,
    to: LSA_ALERT_RECIPIENTS.join(", "),
    subject: `New charged LSA lead — ${accountLabel}`,
    headers: { "X-Priority": "2", "Importance": "High" },
    text,
    html: lsaAlertShell("New charged LSA lead", "#16a34a", rows, "Open Account Manager", ctaUrl),
  });
}

export async function sendLsaCampaignPausedAlert(data: {
  accountName: string | null;
  customerId: string;
  campaignName: string;
  actorEmail: string;
}) {
  const accountLabel = data.accountName || data.customerId;
  const ctaUrl = `${LSA_BASE_URL}/lsa-account-manager`;
  const rows: Array<[string, string]> = [
    ["Account", accountLabel],
    ["Campaign", data.campaignName],
    ["Paused by", data.actorEmail],
    ["When", new Date().toUTCString()],
  ];
  const text = `LSA campaign paused\n\nAccount: ${accountLabel}\nCampaign: ${data.campaignName}\nPaused by: ${data.actorEmail}\n\nReview it: ${ctaUrl}`;
  await sendWithFallback({
    from: `"ConstructHUB LSA" <${process.env.SMTP_EMAIL}>`,
    to: LSA_ALERT_RECIPIENTS.join(", "),
    subject: `LSA campaign paused — ${accountLabel}`,
    headers: { "X-Priority": "2", "Importance": "High" },
    text,
    html: lsaAlertShell("LSA campaign paused", "#d97706", rows, "Open Account Manager", ctaUrl),
  });
}

export async function sendPasswordResetEmail(to: string, token: string, baseUrl: string) {
  const resetUrl = `${baseUrl}/auth?mode=reset-password&token=${token}`;

  await sendWithFallback({
    from: `"ConstructHUB" <${process.env.SMTP_EMAIL}>`,
    to,
    subject: "Reset your password — ConstructHUB",
    priority: "high",
    headers: {
      "X-Priority": "1",
      "X-MSMail-Priority": "High",
      "Importance": "High",
    },
    html: `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px; background: #ffffff;">
        <div style="text-align: center; margin-bottom: 24px;">
          <img src="${baseUrl}/chub-logo-square-text.png" alt="ConstructHUB" style="width: 60px; height: 60px; border-radius: 12px;" />
          <h1 style="color: #F97316; font-size: 24px; margin: 12px 0 0;">ConstructHUB</h1>
          <p style="color: #666; font-size: 13px; margin-top: 4px;">Contractor Services Platform</p>
        </div>
        <h2 style="font-size: 18px; color: #1a1a2e;">Reset your password</h2>
        <p style="color: #444; line-height: 1.6;">Click the button below to set a new password for your account.</p>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${resetUrl}" style="background: linear-gradient(135deg, #F97316, #FB923C); color: white; padding: 14px 36px; border-radius: 8px; text-decoration: none; font-weight: bold; display: inline-block; font-size: 15px;">Reset Password</a>
        </div>
        <p style="color: #888; font-size: 12px;">This link expires in 1 hour. If you didn't request a password reset, you can ignore this email.</p>
      </div>
    `,
  });
}

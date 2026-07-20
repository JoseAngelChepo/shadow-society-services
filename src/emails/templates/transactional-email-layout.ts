export function escapeHtmlForEmail(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export type TransactionalEmailLayoutOptions = {
  eyebrow: string;
  title: string;
  innerHtml: string;
  ctaHtml: string;
  footerRightLabel: string;
};

export function renderTransactionalEmailLayout(
  options: TransactionalEmailLayoutOptions,
): string {
  const e = escapeHtmlForEmail;
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>App</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f3;font-family:'Courier New',monospace;">

  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f3;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;max-width:560px;width:100%;border:1px solid #e8e8e4;">

          <tr>
            <td style="padding:28px 40px;border-bottom:1px solid #e8e8e4;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding-right:8px;vertical-align:middle;">
                    <div style="width:6px;height:6px;border-radius:50%;background:#6b8cae;"></div>
                  </td>
                  <td style="font-family:'Courier New',monospace;font-size:11px;color:#a0a09a;letter-spacing:0.16em;text-transform:uppercase;vertical-align:middle;">
                    App
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:32px 40px 12px 40px;">
              <p style="margin:0 0 6px 0;font-family:'Courier New',monospace;font-size:10px;color:#a0a09a;letter-spacing:0.14em;text-transform:uppercase;">
                ${e(options.eyebrow)}
              </p>
              <h1 style="margin:0;font-family:Georgia,serif;font-size:26px;font-weight:700;color:#111110;line-height:1.3;">
                ${e(options.title)}
              </h1>
              <div style="width:32px;height:2px;background:#6b8cae;margin-top:16px;opacity:0.6;"></div>
            </td>
          </tr>

          <tr>
            <td style="padding:8px 40px 36px 40px;">
              ${options.innerHtml}
            </td>
          </tr>

          ${options.ctaHtml}

          <tr>
            <td style="border-top:1px solid #e8e8e4;padding:20px 40px;background:#fafaf8;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="font-family:'Courier New',monospace;font-size:9px;color:#c0c0ba;text-transform:uppercase;letter-spacing:0.12em;">
                    App &copy; 2026
                  </td>
                  <td align="right">
                    <span style="font-family:'Courier New',monospace;font-size:9px;color:#c0c0ba;letter-spacing:0.1em;text-transform:uppercase;margin-left:20px;">
                      ${e(options.footerRightLabel)}
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>
    `.trim();
}

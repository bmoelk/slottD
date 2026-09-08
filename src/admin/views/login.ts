import { html, raw } from 'hono/html';
import { adminStyles } from '../styles.js';

export function renderLoginView(
  error?: string,
  operatorName?: string,
  operatorEmail?: string,
  redirect?: string
) {
  return html`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Sign In — SlottD Studio Briefcase</title>
      <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512'%3E%3Crect width='512' height='512' rx='96' fill='%231e293b'/%3E%3Cpath d='M 160 128 H 210 V 384 H 160 Z' fill='%23FFD043'/%3E%3Cpath d='M 218 128 H 304 C 364 128 408 172 408 232 H 344 C 344 198 320 184 296 184 H 218 Z' fill='%23FF8A00'/%3E%3Cpath d='M 218 328 H 296 C 320 328 344 314 344 280 H 408 C 408 340 364 384 304 384 H 218 Z' fill='%23FFD043'/%3E%3Crect x='200' y='244' width='112' height='24' rx='4' fill='%23FFE082'/%3E%3C/svg%3E" />
      <style>
        ${adminStyles}
        body {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          background: #090d16;
          margin: 0;
          padding: 20px;
          box-sizing: border-box;
        }
        .login-card {
          width: 100%;
          max-width: 400px;
          background: #0f172a;
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 12px;
          padding: 32px 28px;
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
        }
        .brand-header {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 24px;
        }
        .brand-header h1 {
          font-size: 20px;
          margin: 0;
          font-weight: 700;
          color: #f8fafc;
        }
        .badge-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 12px;
          background: rgba(56, 189, 248, 0.1);
          border: 1px solid rgba(56, 189, 248, 0.25);
          border-radius: 20px;
          font-size: 12px;
          color: #38bdf8;
          margin-bottom: 20px;
        }
        .error-alert {
          background: rgba(239, 68, 68, 0.12);
          border: 1px solid rgba(239, 68, 68, 0.35);
          color: #fca5a5;
          padding: 10px 14px;
          border-radius: 6px;
          font-size: 13px;
          margin-bottom: 18px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .form-group {
          margin-bottom: 20px;
        }
        .form-group label {
          display: block;
          font-size: 12px;
          font-weight: 600;
          color: #cbd5e1;
          margin-bottom: 6px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .form-input {
          width: 100%;
          padding: 10px 14px;
          background: rgba(0, 0, 0, 0.3);
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 6px;
          color: #f8fafc;
          font-size: 14px;
          box-sizing: border-box;
          outline: none;
          transition: border-color 0.15s;
        }
        .form-input:focus {
          border-color: #FF8A00;
        }
        .btn-submit {
          width: 100%;
          padding: 12px;
          background: #FF8A00;
          color: #ffffff;
          border: none;
          border-radius: 6px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.15s;
        }
        .btn-submit:hover {
          background: #e67a00;
        }
        .footer-note {
          margin-top: 20px;
          font-size: 11px;
          color: #64748b;
          text-align: center;
          line-height: 1.4;
        }
      </style>
    </head>
    <body>
      <div class="login-card">
        <div class="brand-header">
          <svg viewBox="0 0 512 512" width="32" height="32">
            <rect width="512" height="512" rx="96" fill="#1e293b"/>
            <path d="M 160 128 H 210 V 384 H 160 Z" fill="#FFD043"/>
            <path d="M 218 128 H 304 C 364 128 408 172 408 232 H 344 C 344 198 320 184 296 184 H 218 Z" fill="#FF8A00"/>
            <path d="M 218 328 H 296 C 320 328 344 314 344 280 H 408 C 408 340 364 384 304 384 H 218 Z" fill="#FFD043"/>
            <rect x="200" y="244" width="112" height="24" rx="4" fill="#FFE082"/>
          </svg>
          <div>
            <h1>SlottD Studio</h1>
            <div style="font-size: 12px; color: #94a3b8;">Briefcase Mode</div>
          </div>
        </div>

        ${operatorName || operatorEmail ? html`
          <div class="badge-pill">
            <span>👤</span>
            <span>${operatorName || 'Operator'} &bull; <strong style="color: #94a3b8; font-weight: normal;">${operatorEmail || 'dev@localhost'}</strong></span>
          </div>
        ` : ''}

        ${error ? html`
          <div class="error-alert">
            <span>⚠️</span>
            <span>${error}</span>
          </div>
        ` : ''}

        <form action="/admin/login" method="POST">
          ${redirect ? html`<input type="hidden" name="redirect" value="${redirect}" />` : ''}
          <div class="form-group">
            <label for="password">Studio Password</label>
            <input
              type="password"
              id="password"
              name="password"
              class="form-input"
              placeholder="••••••••••••"
              required
              autofocus
            />
          </div>

          <button type="submit" class="btn-submit">
            Unlock Briefcase 🔓
          </button>
        </form>

        <div class="footer-note">
          🔒 Protected local session. Password hash is verified using Web Crypto HMAC.
        </div>
      </div>
    </body>
    </html>
  `;
}

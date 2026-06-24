import { useState, useCallback } from "react";
import { useStore } from "../store/useStore";
import { api } from "../utils/api";
import { LoginSchema, RegisterSchema } from "@stock/shared";

const GREEN = "#047857";

type Mode = "login" | "register";

export const Auth: React.FC = () => {
  const setAuth = useStore((s) => s.setAuth);

  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const reset = () => {
    setErrors({});
    setServerError("");
  };

  // ── Login ──────────────────────────────────────────────────────────────────
  const handleLogin = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      reset();

      const result = LoginSchema.safeParse({ username, password });
      if (!result.success) {
        const fe: Record<string, string> = {};
        result.error.errors.forEach((err) => {
          const f = err.path[0] as string;
          if (!fe[f]) fe[f] = err.message;
        });
        setErrors(fe);
        return;
      }

      setIsLoading(true);
      try {
        const response = await api.post("/auth/login", { username, password }, { skipAuth: true });
        setIsSuccess(true);
        setTimeout(() => setAuth(response.user, response.accessToken), 800);
      } catch (err: any) {
        setIsLoading(false);
        setServerError(err?.message || "Login failed. Please check your credentials.");
      }
    },
    [username, password, setAuth]
  );

  // ── Register ────────────────────────────────────────────────────────────────
  const handleRegister = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      reset();

      const nameVal = name.trim() || undefined;
      const result = RegisterSchema.safeParse({ username, password, name: nameVal });
      if (!result.success) {
        const fe: Record<string, string> = {};
        result.error.errors.forEach((err) => {
          const f = err.path[0] as string;
          if (!fe[f]) fe[f] = err.message;
        });
        setErrors(fe);
        return;
      }

      setIsLoading(true);
      try {
        const response = await api.post("/auth/register", { username, password, name: nameVal }, { skipAuth: true });
        setIsSuccess(true);
        setTimeout(() => setAuth(response.user, response.accessToken), 800);
      } catch (err: any) {
        setServerError(err?.message || "Registration failed.");
      } finally {
        setIsLoading(false);
      }
    },
    [username, password, name, setAuth]
  );

  const styles = `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');

    @keyframes auth-enter {
      from { opacity: 0; transform: translateY(16px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    .auth-card { animation: auth-enter 0.5s cubic-bezier(0.16,1,0.3,1) both; font-family: 'Inter', sans-serif; }

    .auth-field-label {
      display: block; font-family: 'Inter', sans-serif; font-size: 11px; font-weight: 600;
      color: #64748b; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 6px;
    }

    .auth-input {
      width: 100%; box-sizing: border-box; background: #f8fafc;
      border: 1.5px solid #e2e8f0; border-radius: 8px; padding: 11px 14px;
      font-family: 'Inter', sans-serif; font-size: 14px; font-weight: 500;
      color: #0f172a; outline: none; transition: border-color 0.2s, box-shadow 0.2s;
    }
    .auth-input:focus { border-color: ${GREEN}; box-shadow: 0 0 0 3px rgba(4,120,87,0.12); background: #fff; }
    .auth-input::placeholder { color: #94a3b8; }
    .auth-input-error { border-color: #ef4444 !important; }
    .auth-input-error:focus { border-color: #ef4444 !important; box-shadow: 0 0 0 3px rgba(239,68,68,0.1) !important; }

    .auth-btn {
      width: 100%; background: ${GREEN}; color: #fff; border: none; border-radius: 8px;
      padding: 13px; font-family: 'Inter', sans-serif; font-size: 14px; font-weight: 700;
      letter-spacing: 0.03em; cursor: pointer; transition: opacity 0.2s, transform 0.1s;
      box-shadow: 0 4px 14px rgba(4,120,87,0.3);
    }
    .auth-btn:hover:not(:disabled) { opacity: 0.9; }
    .auth-btn:active:not(:disabled) { transform: scale(0.99); }
    .auth-btn:disabled { opacity: 0.55; cursor: not-allowed; }

    .auth-tab { background: none; border: none; cursor: pointer; font-family: 'Inter', sans-serif; font-size: 13px; font-weight: 600; padding: 8px 16px; border-radius: 6px; transition: all 0.15s; }
    .auth-tab-active { background: ${GREEN}; color: #fff; }
    .auth-tab-inactive { color: #64748b; }
    .auth-tab-inactive:hover { background: #f1f5f9; color: #0f172a; }

    .auth-link { background: none; border: none; cursor: pointer; font-family: 'Inter', sans-serif; font-size: 12px; font-weight: 600; color: ${GREEN}; text-decoration: underline; padding: 0; }
  `;

  return (
    <>
      <style>{styles}</style>

      <div style={{ width: "100%", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #f8fafc 0%, #f1f5f9 50%, #e2e8f0 100%)", padding: 16, fontFamily: "'Inter', sans-serif" }}>
        <div className="auth-card" style={{ width: "100%", maxWidth: 480, background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: 16, boxShadow: "0 10px 30px -5px rgba(0,0,0,0.06), 0 5px 15px -5px rgba(0,0,0,0.02)", overflow: "hidden" }}>
          <div style={{ height: 4, background: `linear-gradient(90deg, ${GREEN}, #10b981)` }} />

          <div style={{ padding: "40px 40px 32px" }}>
            {/* Header */}
            <div style={{ marginBottom: 28 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
                <div style={{ width: 40, height: 40, borderRadius: 12, background: "rgba(4,120,87,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2.5"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                </div>
                <div>
                  <h1 style={{ margin: 0, fontSize: 22, fontWeight: 900, color: "#0f172a", letterSpacing: "-0.02em" }}>TradePro</h1>
                  <p style={{ margin: 0, fontSize: 11, fontWeight: 500, color: "#64748b", letterSpacing: "0.05em", textTransform: "uppercase" }}>Trading Analytics Suite</p>
                </div>
              </div>

              {/* Tab switcher — only on login/register */}
              {!isSuccess && (
                <div style={{ display: "flex", gap: 4, background: "#f8fafc", borderRadius: 8, padding: 4 }}>
                  <button className={`auth-tab ${mode === "login" ? "auth-tab-active" : "auth-tab-inactive"}`} style={{ flex: 1 }} onClick={() => { setMode("login"); reset(); }}>Sign In</button>
                  <button className={`auth-tab ${mode === "register" ? "auth-tab-active" : "auth-tab-inactive"}`} style={{ flex: 1 }} onClick={() => { setMode("register"); reset(); }}>Create Account</button>
                </div>
              )}
            </div>

            {/* ── SUCCESS ── */}
            {isSuccess ? (
              <div style={{ background: "rgba(4,120,87,0.06)", border: "1.5px solid rgba(4,120,87,0.2)", borderRadius: 10, padding: "24px", textAlign: "center" }}>
                <div style={{ width: 44, height: 44, borderRadius: "50%", background: GREEN, display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: 12 }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
                <p style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 700, color: GREEN }}>Access Authorized</p>
                <p style={{ margin: 0, fontSize: 12, fontWeight: 500, color: "#64748b" }}>Opening dashboard…</p>
              </div>

            ) : mode === "login" ? (
              /* ── LOGIN ── */
              <form onSubmit={handleLogin} noValidate style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                <div>
                  <label className="auth-field-label">Username</label>
                  <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Enter username" autoComplete="username" className={`auth-input ${errors.username ? "auth-input-error" : ""}`} />
                  {errors.username && <p style={{ margin: "6px 0 0", fontSize: 12, fontWeight: 500, color: "#ef4444" }}>{errors.username}</p>}
                </div>
                <div>
                  <label className="auth-field-label">Password</label>
                  <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••••••" autoComplete="current-password" className={`auth-input ${errors.password ? "auth-input-error" : ""}`} />
                  {errors.password && <p style={{ margin: "6px 0 0", fontSize: 12, fontWeight: 500, color: "#ef4444" }}>{errors.password}</p>}
                </div>
                {serverError && (
                  <div style={{ padding: "12px 14px", borderRadius: 8, background: "rgba(239,68,68,0.06)", border: "1.5px solid rgba(239,68,68,0.2)", fontSize: 13, fontWeight: 500, color: "#dc2626" }}>
                    {serverError}
                  </div>
                )}
                <button type="submit" disabled={isLoading} className="auth-btn">
                  {isLoading ? "Signing in…" : "Sign In"}
                </button>
              </form>

            ) : (
              /* ── REGISTER ── */
              <form onSubmit={handleRegister} noValidate style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                <div>
                  <label className="auth-field-label">Username</label>
                  <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Enter username" autoComplete="username" className={`auth-input ${errors.username ? "auth-input-error" : ""}`} />
                  {errors.username && <p style={{ margin: "6px 0 0", fontSize: 12, fontWeight: 500, color: "#ef4444" }}>{errors.username}</p>}
                </div>
                <div>
                  <label className="auth-field-label">Full Name</label>
                  <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="John Doe (Optional)" autoComplete="name" className={`auth-input ${errors.name ? "auth-input-error" : ""}`} />
                  {errors.name && <p style={{ margin: "6px 0 0", fontSize: 12, fontWeight: 500, color: "#ef4444" }}>{errors.name}</p>}
                </div>
                <div>
                  <label className="auth-field-label">Password</label>
                  <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min. 6 characters" autoComplete="new-password" className={`auth-input ${errors.password ? "auth-input-error" : ""}`} />
                  {errors.password && <p style={{ margin: "6px 0 0", fontSize: 12, fontWeight: 500, color: "#ef4444" }}>{errors.password}</p>}
                </div>
                {serverError && (
                  <div style={{ padding: "12px 14px", borderRadius: 8, background: "rgba(239,68,68,0.06)", border: "1.5px solid rgba(239,68,68,0.2)", fontSize: 13, fontWeight: 500, color: "#dc2626" }}>
                    {serverError}
                  </div>
                )}
                <button type="submit" disabled={isLoading} className="auth-btn">
                  {isLoading ? "Creating account…" : "Create Account"}
                </button>
              </form>
            )}

            <p style={{ textAlign: "center", marginTop: 24, fontSize: 11, fontWeight: 500, color: "#94a3b8" }}>
              Pivot Intelligence v1.0 · Secure
            </p>
          </div>
        </div>
      </div>
    </>
  );
};

export default Auth;
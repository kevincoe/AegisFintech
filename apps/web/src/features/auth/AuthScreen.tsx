import React, { useState } from 'react';
import { Landmark, ShieldCheck, Sparkles } from 'lucide-react';
import { apiRequest, setAuthToken } from '../../api/client.js';
import type { DemoUser } from '../../types.js';

interface Props {
  demoUsers: DemoUser[];
  onAuthenticated: (message: string) => void;
  onError: (message: string) => void;
  onQuickSwitch: (userId: string) => void;
}

export function AuthScreen({
  demoUsers,
  onAuthenticated,
  onError,
  onQuickSwitch,
}: Props) {
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [loginEmail, setLoginEmail] = useState('alice@aegis.bank');
  const [loginPassword, setLoginPassword] = useState('password123');
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regDoc, setRegDoc] = useState('');
  const [regPassword, setRegPassword] = useState('password123');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      const res = await apiRequest<{ token: string; user: DemoUser }>('/api/auth/login', {
        method: 'POST',
        body: { email: loginEmail, password: loginPassword },
      });
      setAuthToken(res.token);
      onAuthenticated(`Welcome back, ${res.user.name}!`);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      const res = await apiRequest<{ token: string; user: DemoUser }>('/api/auth/register', {
        method: 'POST',
        body: {
          name: regName,
          email: regEmail,
          documentNumber: regDoc,
          password: regPassword,
        },
      });
      setAuthToken(res.token);
      onAuthenticated(
        `Account created for ${res.user.name}! Provisioned BRL, USD & EUR accounts.`
      );
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center items-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/95 p-8 shadow-2xl">
        <div className="flex items-center gap-3 mb-6">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
            <Landmark className="h-6 w-6" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white">Aegis FinTech</h1>
            <p className="text-xs text-slate-300">
              Institutional Banking, FX & Stock Terminal — Architecture Study Case
            </p>
          </div>
        </div>

        {/* Instant Demo User Quick-Login Cards */}
        {demoUsers.length > 0 && (
          <div className="mb-6 rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-300 mb-2.5">
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              One-Click Study Case Demo Accounts
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              {demoUsers.slice(0, 2).map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => onQuickSwitch(u.id)}
                  className="flex flex-col items-start rounded-lg border border-slate-700 bg-slate-900/90 p-2.5 text-left hover:border-emerald-500/60 hover:bg-slate-800 transition cursor-pointer"
                >
                  <span className="text-xs font-semibold text-white">{u.name}</span>
                  <span className="text-[11px] font-mono text-emerald-400">
                    Acc: {u.accountNumber}
                  </span>
                  <span className="text-[10px] text-slate-300 truncate w-full">{u.email}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Mode Toggle */}
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-950 p-1 mb-5 border border-slate-800">
          <button
            type="button"
            onClick={() => setAuthMode('login')}
            className={`rounded-md py-1.5 text-xs font-semibold transition cursor-pointer ${
              authMode === 'login'
                ? 'bg-slate-800 text-white shadow-xs'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => setAuthMode('register')}
            className={`rounded-md py-1.5 text-xs font-semibold transition cursor-pointer ${
              authMode === 'register'
                ? 'bg-slate-800 text-white shadow-xs'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            Create Account
          </button>
        </div>

        {authMode === 'login' ? (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label
                htmlFor="login-email"
                className="block text-xs font-medium text-slate-300 mb-1"
              >
                Email Address
              </label>
              <input
                id="login-email"
                type="email"
                required
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white focus:border-emerald-500 focus:outline-hidden"
              />
            </div>
            <div>
              <label
                htmlFor="login-password"
                className="block text-xs font-medium text-slate-300 mb-1"
              >
                Password
              </label>
              <input
                id="login-password"
                type="password"
                required
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white focus:border-emerald-500 focus:outline-hidden"
              />
            </div>
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-lg bg-emerald-500 py-2.5 text-sm font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-50 transition cursor-pointer"
            >
              {isSubmitting ? 'Authenticating...' : 'Access Institutional Platform'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleRegister} className="space-y-3.5">
            <div>
              <label htmlFor="reg-name" className="block text-xs font-medium text-slate-300 mb-1">
                Full Name
              </label>
              <input
                id="reg-name"
                type="text"
                required
                placeholder="Carlos Mendes"
                value={regName}
                onChange={(e) => setRegName(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white focus:border-emerald-500 focus:outline-hidden"
              />
            </div>
            <div>
              <label htmlFor="reg-email" className="block text-xs font-medium text-slate-300 mb-1">
                Email Address
              </label>
              <input
                id="reg-email"
                type="email"
                required
                placeholder="carlos@aegis.bank"
                value={regEmail}
                onChange={(e) => setRegEmail(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white focus:border-emerald-500 focus:outline-hidden"
              />
            </div>
            <div>
              <label htmlFor="reg-doc" className="block text-xs font-medium text-slate-300 mb-1">
                CPF / Tax Document (11–14 digits)
              </label>
              <input
                id="reg-doc"
                type="text"
                required
                placeholder="12345678901"
                value={regDoc}
                onChange={(e) => setRegDoc(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm font-mono text-white focus:border-emerald-500 focus:outline-hidden"
              />
            </div>
            <div>
              <label
                htmlFor="reg-password"
                className="block text-xs font-medium text-slate-300 mb-1"
              >
                Password
              </label>
              <input
                id="reg-password"
                type="password"
                required
                value={regPassword}
                onChange={(e) => setRegPassword(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white focus:border-emerald-500 focus:outline-hidden"
              />
            </div>
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-lg bg-emerald-500 py-2.5 text-sm font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-50 transition cursor-pointer"
            >
              {isSubmitting ? 'Provisioning Accounts...' : 'Open Multi-Currency Account'}
            </button>
          </form>
        )}

        <div className="mt-5 flex items-center gap-2 border-t border-slate-800 pt-4 text-[11px] text-slate-300">
          <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
          <span>
            Protected by scrypt password hashing, HTTP-only session cookies, and anti-IDOR boundary
            guards.
          </span>
        </div>
      </div>
    </div>
  );
}

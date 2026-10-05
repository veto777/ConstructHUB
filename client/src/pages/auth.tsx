import { useState, useEffect } from "react";
import { PublicPageHeader } from "@/components/public-page-chrome";
import { Link, useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage, queryClient } from "@/lib/queryClient";
import { useQuery } from "@tanstack/react-query";
import { Mail, Lock, User, Loader2, ArrowLeft, Eye, EyeOff } from "lucide-react";
import { CHLogo } from "@/components/ch-logo";
import { AppleSignInButton } from "@/components/apple-sign-in";
import { CrmLogo } from "@/components/crm-logo";
import { CRM_NAME, isPortal } from "@/lib/site";
import { BRAND_NAME } from "@/lib/marketing";
import { StandingGator } from "@/components/mascot";
import { inNativeApp } from "@/lib/app-shell";
import { BTN_OUTLINE, BTN_PRIMARY, Kicker } from "@/components/feature-landing/primitives";

type AuthMode = "2fa" | "login" | "signup" | "forgot-password" | "reset-password";

export default function AuthPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const { data: user } = useQuery<any>({
    queryKey: ["/api/auth/me"],
  });

  const params = new URLSearchParams(window.location.search);
  const errorParam = params.get("error");
  const modeParam = params.get("mode");
  const tokenParam = params.get("token");
  // CRM beta invite: /auth?beta=<token> starts in signup mode and the token
  // rides along through email/password signup or the Google OAuth round-trip.
  const betaParam = params.get("beta");
  // Post-auth destination (e.g. a team-invite accept page). Same-origin paths
  // only — mirrors safeNextPath in server/auth.ts: one leading "/", never
  // "//host", no backslash (browsers resolve "/\host" off-origin), no
  // whitespace/control chars.
  const rawNext = params.get("next");
  const nextParam = rawNext && /^\/(?!\/)[^\\\x00-\x20\x7f]*$/.test(rawNext) ? rawNext : null;

  useEffect(() => {
    // A beta invite is a NEW-workspace signup. Silently bouncing an
    // already-signed-in browser into its existing workspace made it look
    // like the invite "shared" that workspace's data — never redirect here;
    // the choice card below handles it instead.
    if (user && !betaParam && modeParam !== "forgot-password") setLocation(nextParam ?? "/");
  }, [user, betaParam, nextParam, setLocation]);

  const initialMode: AuthMode =
    modeParam === "2fa" ? "2fa" :
    modeParam === "reset-password" && tokenParam ? "reset-password" :
    modeParam === "forgot-password" ? "forgot-password" :
    modeParam === "signup" || betaParam ? "signup" : "login";

  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [code, setCode] = useState("");
  const [rememberDevice, setRememberDevice] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  // Keep ?mode= in step with the screen (a refresh used to drop forgot-password
  // back to sign-in). next/beta ride along; a stale error/token never does.
  const changeMode = (next: AuthMode) => {
    setMode(next);
    setMessage("");
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("error");
      url.searchParams.delete("token");
      if (next === "login") url.searchParams.delete("mode");
      else url.searchParams.set("mode", next);
      window.history.replaceState(window.history.state, "", url.pathname + url.search);
    } catch { /* URL sync is cosmetic */ }
  };

  useEffect(() => {
    if (errorParam === "invalid-token") {
      toast({ title: "Invalid link", description: "The verification link is invalid or has already been used.", variant: "destructive" });
    } else if (errorParam === "token-expired") {
      toast({ title: "Link expired", description: "The verification link has expired. Please request a new one.", variant: "destructive" });
    } else if (errorParam === "google-failed") {
      toast({ title: "Google login failed", description: "Could not sign in with Google. Please try again.", variant: "destructive" });
    } else if (errorParam === "google-unavailable") {
      toast({ title: "Google sign-in isn't available", description: "Google sign-in isn't set up on this server. Sign in with your email and password instead.", variant: "destructive" });
    } else if (errorParam === "verification-failed") {
      toast({ title: "Verification failed", description: "We couldn't finish verifying your email. Try the link again, or sign in to request a new one.", variant: "destructive" });
    }
  }, [errorParam]);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agreedToTerms) {
      toast({ title: "You must agree to the Terms of Use and Privacy Policy", variant: "destructive" });
      return;
    }
    if (password !== confirmPassword) {
      toast({ title: "Passwords don't match", variant: "destructive" });
      return;
    }
    if (password.length < 8) {
      toast({ title: "Password too short", description: "Must be at least 8 characters.", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      const res = await apiRequest("POST", "/api/auth/signup", {
        email: email.trim(),
        password,
        displayName: displayName.trim() || undefined,
        beta: betaParam || undefined,
        next: nextParam || undefined,
      });
      const data = await res.json();
      setMessage(data.message);
      toast({ title: "Account created!", description: "Check your email for a verification link." });
    } catch (err: any) {
      toast({ title: "Signup failed", description: apiErrorMessage(err, "Signup failed"), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await apiRequest("POST", "/api/auth/login", {
        email: email.trim(),
        password,
      });
      const result = await res.json();
      if (result.requires2FA) { changeMode("2fa"); return; }
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      setLocation(nextParam ?? "/");
    } catch (err: any) {
      const msg = apiErrorMessage(err, "Login failed");
      if (msg.includes("verify your email")) {
        setMessage(msg);
      }
      toast({ title: "Login failed", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const backToSignIn = () => {
    setCode("");
    changeMode("login");
  };

  const handleTwoFactor = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await apiRequest("POST", "/api/auth/2fa/login", { code: code.trim(), rememberDevice });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      setLocation(nextParam ?? "/");
    } catch (err: any) {
      const msg = apiErrorMessage(err, "Verification failed");
      // 400 "…Please start over." — the 10-minute pending sign-in lapsed (or the
      // session was lost), so no code can work any more: go back to sign-in.
      if (/^400\b/.test(String(err?.message ?? "")) && /start over/i.test(msg)) {
        backToSignIn();
        toast({ title: "Your sign-in expired", description: "Sign in again to get a new verification prompt.", variant: "destructive" });
      } else {
        toast({ title: msg, variant: "destructive" });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await apiRequest("POST", "/api/auth/forgot-password", { email: email.trim() });
      const data = await res.json();
      setMessage(data.message);
      toast({ title: "Check your email", description: "If an account exists, a reset link has been sent." });
    } catch {
      toast({ title: "Error", description: "Could not send reset email.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast({ title: "Passwords don't match", variant: "destructive" });
      return;
    }
    if (password.length < 8) {
      toast({ title: "Password too short", description: "Must be at least 8 characters.", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      const res = await apiRequest("POST", "/api/auth/reset-password", { token: tokenParam, password });
      const data = await res.json();
      toast({ title: "Password reset!", description: data.message });
      changeMode("login");
      setPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      toast({ title: "Reset failed", description: apiErrorMessage(err, "Could not reset password."), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleResendVerification = async () => {
    setLoading(true);
    try {
      const res = await apiRequest("POST", "/api/auth/resend-verification", { email: email.trim() });
      const data = await res.json();
      toast({ title: "Email sent", description: data.message });
    } catch {
      toast({ title: "Error", description: "Could not resend verification email.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const termsHref = isPortal() ? "/crm-terms" : "/terms";
  const privacyHref = isPortal() ? "/crm-privacy" : "/privacy";

  // All hooks above are unconditional; this early return is hooks-safe.
  if (user && betaParam) {
    return (
      <div className="mkt-editorial mkt-shadcn min-h-screen bg-mkt-paper text-mkt-ink flex items-start justify-center py-16 px-4">
        <div className="w-full max-w-md rounded-2xl border border-mkt-rule bg-mkt-card p-6 sm:p-8 space-y-4" data-testid="card-beta-signed-in">
          <h1 className="font-display font-semibold text-[1.6rem] leading-tight">You're already signed in</h1>
          <p className="text-[15px] text-mkt-ink-soft leading-relaxed">
            This browser is signed in as <strong className="text-mkt-ink">{user.email}</strong>. A beta invite creates a{" "}
            <strong className="text-mkt-ink">brand-new, empty workspace</strong> — it never opens an existing one. To accept
            the invite as a new account, sign out first; or keep working in your current workspace.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="button-beta-signout"
              className={`${BTN_PRIMARY} h-11 px-5 text-[15px]`}
              onClick={async () => {
                await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
                window.location.reload();
              }}
            >
              Sign out &amp; accept the invite
            </button>
            <button
              type="button"
              data-testid="button-beta-continue"
              className={`${BTN_OUTLINE} h-11 px-5 text-[15px]`}
              onClick={() => setLocation("/")}
            >
              Go to my workspace
            </button>
          </div>
        </div>
      </div>
    );
  }

  const bubble = BUBBLE[mode];
  const app = inNativeApp();

  return (
    <>
    {/* The site's ribbon, as on every public page (owner, 2026-10-02) — but not in the iPhone apps, where the
        sign-in screen is the whole app: one logo (below), and the page itself clears the status bar. */}
    {!app && <PublicPageHeader next={nextParam ?? "/"} />}
    <div className={`${app ? "app-status-pad " : ""}mkt-editorial mkt-shadcn min-h-screen bg-mkt-paper text-mkt-ink lg:grid lg:grid-cols-12`} data-testid="page-auth" data-auth-mode={mode}>
      {/* The form: cream paper with the drafting grid fading out below the masthead. */}
      <div className="relative lg:col-span-7 xl:col-span-6 flex flex-col min-h-screen">
        <div className="absolute inset-x-0 top-0 h-[28rem] mkt-grid-paper [mask-image:linear-gradient(to_bottom,black_0%,transparent_100%)]" aria-hidden />
        <div className="relative flex-1 flex flex-col items-center px-4 sm:px-6 py-8 sm:py-12 lg:justify-center">
          <div className="w-full max-w-[28rem] space-y-6">
            <div className="text-center lg:text-left space-y-3">
              {/* One logo per screen: on phone browsers the ribbon above already shows it; the apps have no ribbon. */}
              <div className={`${app ? "flex pt-2" : "hidden lg:flex"} justify-center lg:justify-start`}>
                {isPortal()
                  ? <CrmLogo height={app ? 52 : 40} />
                  : <Link href="/" aria-label={`${BRAND_NAME} home`} data-testid="link-auth-logo-home"><CHLogo height={app ? 60 : 46} /></Link>}
              </div>
              {/* In the apps the logo already reads ConstructHUB (CRM): the title stays for screen readers only. */}
              <h1 className={`${app ? "sr-only " : ""}font-display font-semibold text-[1.9rem] leading-none tracking-[-0.02em] text-mkt-ink`} data-testid="text-auth-title">
                {isPortal()
                  ? <>ConstructHub <em className="text-mkt-orange-ink">CRM</em></>
                  : <>Construct<em className="text-mkt-orange-ink">HUB</em></>}
              </h1>
              <Kicker n="" className="justify-center lg:justify-start">
                {isPortal() ? "Projects, clients & payments for contractors" : "Nationwide Contractor Services"}
              </Kicker>
            </div>

            {/* Phones and tablets: the gator stands beside the card's top, facing his line; the bubble's tail
                points back at him (.mkt-bubble-left), the two centered as one group. */}
            <div className="lg:hidden flex items-start justify-center gap-2 px-2" aria-hidden>
              <StandingGator height={96} className="shrink-0" />
              <p className="mkt-bubble mkt-bubble-left mt-3 px-4 py-2.5 text-[17px] leading-snug max-w-[13rem]" data-testid="text-auth-bubble-small">{bubble}</p>
            </div>

            <Card className="relative p-6 sm:p-8 space-y-5 rounded-2xl border-mkt-rule bg-mkt-card shadow-none -mt-2 lg:mt-0">
              {mode === "2fa" && (
                <>
                  <div className="space-y-1">
                    <button
                      type="button"
                      onClick={backToSignIn}
                      className={BACK_LINK}
                      data-testid="button-2fa-back"
                    >
                      <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
                    </button>
                    <h2 className={FORM_TITLE} data-testid="text-form-title">Two-factor sign-in</h2>
                    <p className={FORM_LEDE}>
                      Enter the code from your authenticator app, or one of your recovery codes.
                    </p>
                  </div>
                  <form className="space-y-4" onSubmit={handleTwoFactor}>
                    <div className="space-y-2">
                      <Label htmlFor="two-factor-code" className={FIELD_LABEL}>Authenticator or recovery code</Label>
                      <Input
                        id="two-factor-code"
                        value={code}
                        onChange={e => setCode(e.target.value)}
                        autoComplete="one-time-code"
                        maxLength={16}
                        className={FIELD}
                        data-testid="input-2fa-code"
                      />
                    </div>
                    <label className="flex items-center gap-2 text-sm text-mkt-ink-soft">
                      <input type="checkbox" checked={rememberDevice} onChange={e => setRememberDevice(e.target.checked)} className="h-4 w-4 accent-primary" />
                      Remember this device for 30 days
                    </label>
                    <Button type="submit" className={SUBMIT} disabled={loading || !code.trim()} data-testid="button-2fa-verify">
                      {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                      Verify sign-in
                    </Button>
                  </form>
                  <p className="text-center text-[13px] text-mkt-ink-soft">
                    Wrong account, or want to use Google instead?{" "}
                    <button type="button" onClick={backToSignIn} className={TEXT_BUTTON} data-testid="link-2fa-start-over">
                      Start over
                    </button>
                  </p>
                </>
              )}
              {mode === "login" && (
                <>
                  <div className="space-y-1">
                    <h2 className={FORM_TITLE} data-testid="text-form-title">Welcome back</h2>
                    <p className={FORM_LEDE}>Sign in to your account</p>
                  </div>

                  <AppleSignInButton label="Continue with Apple" next={nextParam} testId="button-apple-login" />
                  <a href={nextParam ? `/api/auth/google?next=${encodeURIComponent(nextParam)}` : "/api/auth/google"} className={GOOGLE_BUTTON} data-testid="link-google-login">
                    <GoogleMark />
                    Continue with Google
                  </a>

                  <OrRule />

                  <form onSubmit={handleLogin} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="login-email" className={FIELD_LABEL}>Email</Label>
                      <div className="relative">
                        <Mail className={FIELD_ICON} />
                        <Input
                          id="login-email"
                          type="email"
                          value={email}
                          onChange={e => setEmail(e.target.value)}
                          placeholder="you@example.com"
                          className={`${FIELD} pl-10`}
                          required
                          data-testid="input-login-email"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="login-password" className={FIELD_LABEL}>Password</Label>
                      <div className="relative">
                        <Lock className={FIELD_ICON} />
                        <Input
                          id="login-password"
                          type={showPassword ? "text" : "password"}
                          value={password}
                          onChange={e => setPassword(e.target.value)}
                          placeholder="Enter your password"
                          className={`${FIELD} pl-10 pr-10`}
                          required
                          data-testid="input-login-password"
                        />
                        <PasswordToggle shown={showPassword} onToggle={() => setShowPassword(!showPassword)} />
                      </div>
                    </div>
                    <Button type="submit" className={SUBMIT} disabled={loading} data-testid="button-login">
                      {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                      Sign In
                    </Button>
                  </form>

                  {message && message.includes("verify") && (
                    <div className="text-center">
                      <button type="button" className={TEXT_BUTTON} onClick={handleResendVerification} disabled={loading} data-testid="button-resend-verification">
                        Resend verification email
                      </button>
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-3 text-[13px] pt-1">
                    <button
                      type="button"
                      onClick={() => changeMode("forgot-password")}
                      className={TEXT_BUTTON}
                      data-testid="link-forgot-password"
                    >
                      Forgot password?
                    </button>
                    <button
                      type="button"
                      onClick={() => changeMode("signup")}
                      className={TEXT_BUTTON}
                      data-testid="link-goto-signup"
                    >
                      Create an account
                    </button>
                  </div>
                </>
              )}

              {mode === "signup" && (
                <>
                  <div className="space-y-1">
                    <h2 className={FORM_TITLE} data-testid="text-form-title">Create your account</h2>
                    <p className={FORM_LEDE}>Get started with {isPortal() ? CRM_NAME : BRAND_NAME}</p>
                  </div>

                  {betaParam && (
                    <div className="rounded-xl border border-mkt-orange bg-[color:var(--mkt-orange-soft)] px-3.5 py-2.5 text-sm text-mkt-ink" data-testid="banner-beta-invite">
                      You're invited to the ConstructHub CRM beta — unlimited access during beta.
                    </div>
                  )}

                  <AppleSignInButton label="Sign up with Apple" next={nextParam} testId="button-apple-signup" />
                  <a href={betaParam ? `/api/auth/google?beta=${encodeURIComponent(betaParam)}` : nextParam ? `/api/auth/google?next=${encodeURIComponent(nextParam)}` : "/api/auth/google"} className={GOOGLE_BUTTON} data-testid="link-google-signup">
                    <GoogleMark />
                    Sign up with Google
                  </a>

                  <OrRule />

                  {message ? (
                    <div className="text-center space-y-3 py-4">
                      <div className="flex justify-center">
                        <Mail className="h-10 w-10 text-mkt-orange" />
                      </div>
                      <p className="font-display font-semibold text-[1.2rem] text-mkt-ink">Check your email</p>
                      <p className="text-sm text-mkt-ink-soft">{message}</p>
                      <button type="button" className={TEXT_BUTTON} onClick={handleResendVerification} disabled={loading} data-testid="button-resend-signup">
                        Resend verification email
                      </button>
                    </div>
                  ) : (
                    <form onSubmit={handleSignup} className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="signup-name" className={FIELD_LABEL}>Full Name</Label>
                        <div className="relative">
                          <User className={FIELD_ICON} />
                          <Input
                            id="signup-name"
                            type="text"
                            value={displayName}
                            onChange={e => setDisplayName(e.target.value)}
                            placeholder="John Doe"
                            className={`${FIELD} pl-10`}
                            data-testid="input-signup-name"
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="signup-email" className={FIELD_LABEL}>Email</Label>
                        <div className="relative">
                          <Mail className={FIELD_ICON} />
                          <Input
                            id="signup-email"
                            type="email"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            placeholder="you@example.com"
                            className={`${FIELD} pl-10`}
                            required
                            data-testid="input-signup-email"
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="signup-password" className={FIELD_LABEL}>Password</Label>
                        <div className="relative">
                          <Lock className={FIELD_ICON} />
                          <Input
                            id="signup-password"
                            type={showPassword ? "text" : "password"}
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            placeholder="At least 8 characters"
                            className={`${FIELD} pl-10 pr-10`}
                            required
                            data-testid="input-signup-password"
                          />
                          <PasswordToggle shown={showPassword} onToggle={() => setShowPassword(!showPassword)} />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="signup-confirm" className={FIELD_LABEL}>Confirm Password</Label>
                        <div className="relative">
                          <Lock className={FIELD_ICON} />
                          <Input
                            id="signup-confirm"
                            type={showPassword ? "text" : "password"}
                            value={confirmPassword}
                            onChange={e => setConfirmPassword(e.target.value)}
                            placeholder="Confirm your password"
                            className={`${FIELD} pl-10`}
                            required
                            data-testid="input-signup-confirm"
                          />
                        </div>
                      </div>
                      <label className="flex items-start gap-2.5 text-[13px] leading-relaxed text-mkt-ink-soft cursor-pointer">
                        <input type="checkbox" checked={agreedToTerms} onChange={e => setAgreedToTerms(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-primary" data-testid="checkbox-agree-terms" />
                        <span>I agree to the <a href={termsHref} target="_blank" rel="noopener noreferrer" className={INLINE_LINK} data-testid="link-signup-terms">Terms of Use</a> and <a href={privacyHref} target="_blank" rel="noopener noreferrer" className={INLINE_LINK} data-testid="link-signup-privacy">Privacy Policy</a></span>
                      </label>
                      <Button type="submit" className={SUBMIT} disabled={loading || !agreedToTerms} data-testid="button-signup">
                        {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                        Create Account
                      </Button>
                    </form>
                  )}

                  <div className="text-center text-[13px]">
                    <button
                      type="button"
                      onClick={() => changeMode("login")}
                      className={TEXT_BUTTON}
                      data-testid="link-goto-login"
                    >
                      Already have an account? Sign in
                    </button>
                  </div>
                </>
              )}

              {mode === "forgot-password" && (
                <>
                  <div className="space-y-1">
                    <button
                      type="button"
                      onClick={() => changeMode("login")}
                      className={BACK_LINK}
                    >
                      <ArrowLeft className="h-3.5 w-3.5" /> Back to login
                    </button>
                    <h2 className={FORM_TITLE}>Reset your password</h2>
                    <p className={FORM_LEDE}>Enter your email and we'll send you a reset link</p>
                  </div>

                  {message ? (
                    <div className="text-center space-y-3 py-4">
                      <Mail className="h-10 w-10 text-mkt-orange mx-auto" />
                      <p className="font-display font-semibold text-[1.2rem] text-mkt-ink">Check your email</p>
                      <p className="text-sm text-mkt-ink-soft">{message}</p>
                    </div>
                  ) : (
                    <form onSubmit={handleForgotPassword} className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="forgot-email" className={FIELD_LABEL}>Email</Label>
                        <div className="relative">
                          <Mail className={FIELD_ICON} />
                          <Input
                            id="forgot-email"
                            type="email"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            placeholder="you@example.com"
                            className={`${FIELD} pl-10`}
                            required
                            data-testid="input-forgot-email"
                          />
                        </div>
                      </div>
                      <Button type="submit" className={SUBMIT} disabled={loading} data-testid="button-send-reset">
                        {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                        Send Reset Link
                      </Button>
                    </form>
                  )}
                </>
              )}

              {mode === "reset-password" && (
                <>
                  <div className="space-y-1">
                    <h2 className={FORM_TITLE}>Set new password</h2>
                    <p className={FORM_LEDE}>Choose a new password for your account</p>
                  </div>

                  <form onSubmit={handleResetPassword} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="reset-password" className={FIELD_LABEL}>New Password</Label>
                      <div className="relative">
                        <Lock className={FIELD_ICON} />
                        <Input
                          id="reset-password"
                          type={showPassword ? "text" : "password"}
                          value={password}
                          onChange={e => setPassword(e.target.value)}
                          placeholder="At least 8 characters"
                          className={`${FIELD} pl-10 pr-10`}
                          required
                          data-testid="input-reset-password"
                        />
                        <PasswordToggle shown={showPassword} onToggle={() => setShowPassword(!showPassword)} />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="reset-confirm" className={FIELD_LABEL}>Confirm Password</Label>
                      <div className="relative">
                        <Lock className={FIELD_ICON} />
                        <Input
                          id="reset-confirm"
                          type={showPassword ? "text" : "password"}
                          value={confirmPassword}
                          onChange={e => setConfirmPassword(e.target.value)}
                          placeholder="Confirm your password"
                          className={`${FIELD} pl-10`}
                          required
                          data-testid="input-reset-confirm"
                        />
                      </div>
                    </div>
                    <Button type="submit" className={SUBMIT} disabled={loading} data-testid="button-reset-password">
                      {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                      Reset Password
                    </Button>
                  </form>
                </>
              )}
            </Card>

            {mode === "signup" && (
              <p className="text-center text-[13px] leading-relaxed text-mkt-ink-soft" data-testid="text-signup-agreement">
                By signing up — including with Google — you agree to our{" "}
                <a href={termsHref} target="_blank" rel="noopener noreferrer" className={INLINE_LINK}>Terms of Use</a>
                {" "}and{" "}
                <a href={privacyHref} target="_blank" rel="noopener noreferrer" className={INLINE_LINK}>Privacy Policy</a>.
              </p>
            )}

            {/* Not in the apps: "home" there is this screen (the marketing site is not part of the apps). */}
            {!isPortal() && !app && (
              <p className="text-center text-[13px]">
                <Link href="/" className="inline-flex items-center gap-1.5 font-semibold text-mkt-muted hover:text-mkt-ink transition-colors" data-testid="link-auth-home">
                  <ArrowLeft className="h-3.5 w-3.5" /> Back to {BRAND_NAME} home
                </Link>
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Desktop: the gator and his line on the navy grid panel, pinned while the form scrolls. */}
      <aside className="hidden lg:block lg:col-span-5 xl:col-span-6 lg:sticky lg:top-0 lg:h-screen p-4 xl:p-5" aria-hidden>
        <div className="relative h-full overflow-hidden rounded-[32px] bg-mkt-panel text-mkt-panel-ink flex flex-col">
          <div className="absolute inset-0 mkt-grid-paper-panel" />
          <div className="relative flex-1 flex flex-col items-center justify-end gap-8 px-10 pt-12">
            <p className="mkt-bubble px-6 py-4 text-[22px] xl:text-[24px] leading-snug max-w-[22rem] -rotate-1" data-testid="text-auth-bubble">{bubble}</p>
            <StandingGator height={420} className="shrink-0 -mb-1 max-h-[58vh] w-auto" />
          </div>
          <div className="relative mkt-ruler" style={{ "--mkt-ink": "var(--mkt-panel-ink)" } as React.CSSProperties} />
        </div>
      </aside>
    </div>
    </>
  );
}

/** What the gator says on each screen. */
const BUBBLE: Record<AuthMode, string> = {
  signup: "Welcome in — let's build your business.",
  login: "Welcome back.",
  "2fa": "Welcome back.",
  "forgot-password": "Let's get you back on the job.",
  "reset-password": "Let's get you back on the job.",
};

// Design B recipes for the form (the shadcn controls take the editorial
// tokens from the page's `mkt-shadcn` scope; these set size and type).
const FORM_TITLE = "font-display font-semibold text-[1.65rem] leading-tight tracking-[-0.015em] text-mkt-ink";
const FORM_LEDE = "text-[15px] text-mkt-ink-soft";
const FIELD_LABEL = "text-[12px] font-semibold uppercase tracking-[0.12em] text-mkt-ink-soft";
const FIELD = "h-11 rounded-lg bg-mkt-paper text-[15px] md:text-[15px] focus-visible:ring-offset-0";
const FIELD_ICON = "absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-mkt-muted pointer-events-none";
const SUBMIT = "w-full h-11 rounded-lg text-[15px] font-semibold";
const GOOGLE_BUTTON = "flex w-full items-center justify-center gap-2.5 h-11 rounded-lg border-2 border-mkt-ink bg-mkt-card text-[15px] font-semibold text-mkt-ink hover:bg-mkt-paper-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mkt-orange focus-visible:ring-offset-2 focus-visible:ring-offset-mkt-card";
const TEXT_BUTTON = "font-semibold text-mkt-orange-ink underline decoration-2 decoration-transparent underline-offset-4 hover:decoration-mkt-orange transition-colors disabled:opacity-50";
const INLINE_LINK = "font-semibold text-mkt-orange-ink underline decoration-mkt-orange-soft decoration-2 underline-offset-[3px] hover:decoration-mkt-orange";
const BACK_LINK = "inline-flex items-center gap-1.5 text-[13px] font-semibold text-mkt-muted hover:text-mkt-ink mb-3 transition-colors";

function OrRule() {
  return (
    <div className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-mkt-muted" aria-hidden>
      <span className="h-px flex-1 bg-mkt-rule" /> or <span className="h-px flex-1 bg-mkt-rule" />
    </div>
  );
}

function PasswordToggle({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={shown ? "Hide password" : "Show password"}
      className="absolute right-3 top-1/2 -translate-y-1/2 text-mkt-muted hover:text-mkt-ink"
    >
      {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
    </button>
  );
}

function GoogleMark() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

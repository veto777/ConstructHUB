import { useState, useEffect, useRef } from "react";
import { PublicPageHeader } from "@/components/public-page-chrome";
import { SocialLinks } from "@/components/social-links";
import { YOUTUBE_CHANNEL_URL } from "@shared/social-links";
import { Link, useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage, queryClient } from "@/lib/queryClient";
import { useQuery } from "@tanstack/react-query";
import { Mail, Lock, Loader2, ArrowLeft, Eye, EyeOff, Phone, Building2 } from "lucide-react";
import { CHLogo } from "@/components/ch-logo";
import { AppleSignInButton } from "@/components/apple-sign-in";
import { CrmLogo } from "@/components/crm-logo";
import { CRM_NAME, isPortal } from "@/lib/site";
import { BRAND_NAME } from "@/lib/marketing";
import { StandingGator } from "@/components/mascot";
import { inNativeApp } from "@/lib/app-shell";
import { BTN_OUTLINE, BTN_PRIMARY, Kicker } from "@/components/feature-landing/primitives";
import { trackConversion } from "@/lib/gtag";
import { SIGNUP_TEAM_SIZES, SIGNUP_TRADES, formatUsPhoneInput, normalizeSignupEmail, parseSignupDetails } from "@shared/signup";

// "finish": a brand-new Google account answers sign-up's step 2 once (server/auth.ts finishGoogleLogin).
type AuthMode = "2fa" | "login" | "signup" | "finish" | "forgot-password" | "reset-password";
type SignupStep = 1 | 2 | 3;

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
    if (user && !betaParam && modeParam !== "forgot-password" && modeParam !== "finish") setLocation(nextParam ?? "/");
  }, [user, betaParam, nextParam, setLocation]);

  const initialMode: AuthMode =
    modeParam === "2fa" ? "2fa" :
    modeParam === "reset-password" && tokenParam ? "reset-password" :
    modeParam === "forgot-password" ? "forgot-password" :
    modeParam === "finish" ? "finish" :
    modeParam === "signup" || betaParam ? "signup" : "login";

  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [code, setCode] = useState("");
  const [rememberDevice, setRememberDevice] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  // The three-step sign-up's screen, so the gator's line and the notes under the card follow it.
  const [signupStep, setSignupStep] = useState<SignupStep>(1);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");

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

  const bubble = mode === "signup" ? SIGNUP_BUBBLE[signupStep] : BUBBLE[mode];
  // Sign-up and its Google follow-up are task screens: on a phone the card (and its button) start right
  // under the ribbon — the wordmark and the gator's line show from the desktop layout up (owner, 2026-10-21).
  const taskScreen = mode === "signup" || mode === "finish";
  // Past step 1 the questions need the room on a laptop screen too: the masthead steps aside there as well.
  // "Finish setting up" keeps it — a signed-in visitor has no ribbon above, so it is the page's only logo.
  const questionScreen = mode === "signup" && signupStep > 1;
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
        <div className={`relative flex-1 flex flex-col items-center px-4 sm:px-6 ${taskScreen ? "pt-4 pb-8" : "py-8"} sm:py-12 lg:justify-center`}>
          <div className="w-full max-w-[28rem] space-y-6">
            <div className={`${questionScreen && !app ? "hidden " : mode === "signup" && !app ? "hidden lg:block " : ""}text-center lg:text-left space-y-3`}>
              {/* One logo per screen: on phone browsers the ribbon above already shows it; the apps have no ribbon. */}
              <div className={`${app ? "flex pt-2" : "hidden lg:flex"} justify-center lg:justify-start`}>
                {isPortal()
                  ? <CrmLogo height={app ? 52 : 40} />
                  : <Link href="/" aria-label={`${BRAND_NAME} home`} data-testid="link-auth-logo-home"><CHLogo height={app ? 60 : 46} /></Link>}
              </div>
              {/* In the apps the logo already reads ConstructHUB (CRM): the wordmark stays for screen readers only.
                  It is not the page's h1: each form's own title ("Welcome back", "Create your account"…) is. */}
              <p className={`${app ? "sr-only " : ""}font-display font-semibold text-[1.9rem] leading-none tracking-[-0.02em] text-mkt-ink`} data-testid="text-auth-title">
                {isPortal()
                  ? <>ConstructHub <em className="text-mkt-orange-ink">CRM</em></>
                  : <>Construct<em className="text-mkt-orange-ink">HUB</em></>}
              </p>
              <Kicker n="" className="justify-center lg:justify-start">
                {isPortal() ? "Projects, clients & payments for contractors" : "Nationwide Contractor Services"}
              </Kicker>
            </div>

            {/* Phones and tablets: the gator stands beside the card's top, facing his line; the bubble's tail
                points back at him (.mkt-bubble-left), the two centered as one group. */}
            <div className={`${taskScreen ? "hidden" : "lg:hidden flex"} items-start justify-center gap-2 px-2`} aria-hidden>
              <StandingGator height={96} className="shrink-0" />
              <p className="mkt-bubble mkt-bubble-left mt-3 px-4 py-2.5 text-[17px] leading-snug max-w-[13rem]" data-testid="text-auth-bubble-small">{bubble}</p>
            </div>

            <Card className={`relative ${taskScreen ? "p-5" : "p-6"} sm:p-8 space-y-5 rounded-2xl border-mkt-rule bg-mkt-card shadow-none -mt-2 lg:mt-0`}>
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
                    <h1 className={FORM_TITLE} data-testid="text-form-title">Two-factor sign-in</h1>
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
                    <h1 className={FORM_TITLE} data-testid="text-form-title">Welcome back</h1>
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
                <SignupSteps
                  betaParam={betaParam}
                  nextParam={nextParam}
                  prefillEmail={params.get("email")}
                  termsHref={termsHref}
                  privacyHref={privacyHref}
                  onStepChange={setSignupStep}
                  onSignIn={(known) => { setEmail(known); changeMode("login"); }}
                />
              )}

              {mode === "finish" && <FinishSetup user={user} nextParam={nextParam} />}

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
                    <h1 className={FORM_TITLE}>Reset your password</h1>
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
                    <h1 className={FORM_TITLE}>Set new password</h1>
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

            {mode === "signup" && signupStep === 1 && (
              <p className="text-center text-[13px] leading-relaxed text-mkt-ink-soft" data-testid="text-signup-agreement">
                By signing up — including with Google — you agree to our{" "}
                <a href={termsHref} target="_blank" rel="noopener noreferrer" className={INLINE_LINK}>Terms of Use</a>
                {" "}and{" "}
                <a href={privacyHref} target="_blank" rel="noopener noreferrer" className={INLINE_LINK}>Privacy Policy</a>.
              </p>
            )}

            {/* The walkthrough videos and the social accounts: a quiet line under the form, never above it. */}
            <div className="space-y-1 text-center text-[13px] text-mkt-ink-soft" data-testid="auth-social">
              {mode === "signup" && signupStep === 1 && (
                <p>
                  New here?{" "}
                  <a href={YOUTUBE_CHANNEL_URL} target="_blank" rel="noopener noreferrer" className={INLINE_LINK} data-testid="link-signup-youtube-tour">
                    Watch a 1-minute walkthrough on YouTube
                  </a>
                </p>
              )}
              <SocialLinks tone="paper" testId="social-auth" />
            </div>

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
  finish: "Almost there — tell me about your business.",
  login: "Welcome back.",
  "2fa": "Welcome back.",
  "forgot-password": "Let's get you back on the job.",
  "reset-password": "Let's get you back on the job.",
};

const SIGNUP_BUBBLE: Record<SignupStep, string> = {
  1: "Welcome in — let's build your business.",
  2: "Tell me about your crew.",
  3: "Last step — lock it down.",
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

// ── The three-step sign-up ──────────────────────────────────────────────────────────────────
// Owner, 2026-10-21: "fix the sign-up flow like the competitors" (Housecall Pro, Jobber, Roofr).
// 1 "Start free": Google or one email field — the email is saved as a lead on Continue
//   (server/signup-leads.ts), so the team can follow up even if they stop here.
// 2 "About your business": name, mobile, trade, team size.
// 3 "Create your password": then POST /api/auth/signup as before (verification email unchanged).
// /auth?mode=signup&email=… (the landing page's hero field) saves the email and opens on step 2.

type BusinessAnswers = { firstName: string; lastName: string; phone: string; trade: string; teamSize: string };
const NO_ANSWERS: BusinessAnswers = { firstName: "", lastName: "", phone: "", trade: "", teamSize: "" };

function SignupSteps({ betaParam, nextParam, prefillEmail, termsHref, privacyHref, onStepChange, onSignIn }: {
  betaParam: string | null;
  nextParam: string | null;
  prefillEmail: string | null;
  termsHref: string;
  privacyHref: string;
  onStepChange: (step: SignupStep) => void;
  onSignIn: (email: string) => void;
}) {
  const { toast } = useToast();
  const prefill = normalizeSignupEmail(prefillEmail);
  const [step, setStepState] = useState<SignupStep>(1);
  const [email, setEmail] = useState(prefill ?? "");
  const [existing, setExisting] = useState<string | null>(null);
  const [answers, setAnswers] = useState<BusinessAnswers>(NO_ANSWERS);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState("");

  // Each step is a browser history entry, so a phone's Back gesture goes back a step, not off the page.
  const setStep = (next: SignupStep, push = true) => {
    setStepState(next);
    setError("");
    onStepChange(next);
    if (push) {
      try { window.history.pushState({ ...(window.history.state ?? {}), signupStep: next }, "", window.location.href); } catch { /* cosmetic */ }
    }
  };
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const back = e.state?.signupStep;
      if (back === 1 || back === 2 || back === 3) setStep(back, false);
      else setStep(1, false);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  /** Step 1's save. Resolves true to move on; only a refused email or an existing account stops the visitor. */
  const saveLead = async (value: string, source: string): Promise<boolean> => {
    try {
      const res = await apiRequest("POST", "/api/auth/signup-lead", { email: value, source });
      const data = await res.json();
      if (data.exists) { setExisting(value); return false; }
      return true;
    } catch (err: any) {
      const status = String(err?.message ?? "").slice(0, 3);
      if (status === "400" || status === "429") { setError(apiErrorMessage(err, "Enter a valid email address")); return false; }
      return true; // the lead is follow-up data: a hiccup saving it never blocks a sign-up
    }
  };

  // The hand-off from the landing page: save the email it collected, then ask step 2's questions.
  const prefillDone = useRef(false);
  useEffect(() => {
    if (!prefill || prefillDone.current) return;
    prefillDone.current = true;
    setLoading(true);
    void saveLead(prefill, "prefill").then((ok) => { if (ok) setStep(2); }).finally(() => setLoading(false));
  }, [prefill]);

  const submitEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setExisting(null);
    const value = normalizeSignupEmail(email);
    if (!value) { setError("Enter a valid email address"); return; }
    setLoading(true);
    try { if (await saveLead(value, "auth")) setStep(2); } finally { setLoading(false); }
  };

  const submitAnswers = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseSignupDetails(answers);
    if (!parsed.ok) { setError(parsed.message); return; }
    setLoading(true);
    try {
      await apiRequest("POST", "/api/auth/signup-lead/details", parsed.details);
    } catch (err: any) {
      // A refused answer is shown; a lapsed lead or a hiccup is not the visitor's problem — step 3 sends it all again.
      if (String(err?.message ?? "").startsWith("400") && !/start again/i.test(apiErrorMessage(err, ""))) {
        setError(apiErrorMessage(err, "Check your answers"));
        setLoading(false);
        return;
      }
    }
    setLoading(false);
    setStep(3);
  };

  const createAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) { setError("Your password needs at least 8 characters"); return; }
    if (!agreed) { setError("Agree to the Terms of Use and Privacy Policy to continue"); return; }
    const parsed = parseSignupDetails(answers);
    if (!parsed.ok) { setStep(2); setError(parsed.message); return; }
    setLoading(true);
    try {
      const res = await apiRequest("POST", "/api/auth/signup", {
        email: normalizeSignupEmail(email),
        password,
        ...parsed.details,
        companyName: companyName.trim() || undefined,
        beta: betaParam || undefined,
        next: nextParam || undefined,
      });
      const data = await res.json();
      setSent(data.message);
      trackConversion("signup", {}, { eventId: typeof data.metaEventId === "string" ? data.metaEventId : undefined });
    } catch (err: any) {
      toast({ title: "Signup failed", description: apiErrorMessage(err, "Signup failed"), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    setLoading(true);
    try {
      const res = await apiRequest("POST", "/api/auth/resend-verification", { email: normalizeSignupEmail(email) });
      toast({ title: "Email sent", description: (await res.json()).message });
    } catch {
      toast({ title: "Error", description: "Could not resend verification email.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <div className="text-center space-y-3 py-4" data-testid="signup-check-email">
        <div className="flex justify-center"><Mail className="h-10 w-10 text-mkt-orange" /></div>
        <h1 className="font-display font-semibold text-[1.4rem] text-mkt-ink">Check your email</h1>
        <p className="text-sm text-mkt-ink-soft">
          We sent a link to <strong className="text-mkt-ink">{normalizeSignupEmail(email)}</strong>. Open it to verify your email, then sign in.
        </p>
        <button type="button" className={TEXT_BUTTON} onClick={resend} disabled={loading} data-testid="button-resend-signup">
          Resend verification email
        </button>
      </div>
    );
  }

  return (
    <div className={step === 1 ? "space-y-5" : "space-y-4"} data-testid="signup-steps" data-signup-step={step}>
      <StepHeader step={step} onBack={step > 1 ? () => window.history.back() : undefined} />

      {step === 1 && (
        <>
          <div className="space-y-1">
            <h1 className={FORM_TITLE} data-testid="text-form-title">Start free</h1>
            <p className={FORM_LEDE}>Set up your {isPortal() ? CRM_NAME : BRAND_NAME} account in about a minute.</p>
          </div>

          {betaParam && (
            <div className="rounded-xl border border-mkt-orange bg-[color:var(--mkt-orange-soft)] px-3.5 py-2.5 text-sm text-mkt-ink" data-testid="banner-beta-invite">
              You're invited to the ConstructHub CRM beta — unlimited access during beta.
            </div>
          )}

          <AppleSignInButton label="Sign up with Apple" next={nextParam} testId="button-apple-signup" />
          <a href={betaParam ? `/api/auth/google?beta=${encodeURIComponent(betaParam)}` : nextParam ? `/api/auth/google?next=${encodeURIComponent(nextParam)}` : "/api/auth/google"} className={GOOGLE_BUTTON} data-testid="link-google-signup">
            <GoogleMark />
            Continue with Google
          </a>

          <OrRule />

          <form onSubmit={submitEmail} className="space-y-3" noValidate>
            <div className="space-y-2">
              <Label htmlFor="signup-email" className={FIELD_LABEL}>Work email</Label>
              <div className="relative">
                <Mail className={FIELD_ICON} />
                <Input
                  id="signup-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError(""); setExisting(null); }}
                  placeholder="you@yourcompany.com"
                  className={`${FIELD} pl-10`}
                  aria-invalid={!!error}
                  data-testid="input-signup-email"
                />
              </div>
            </div>
            <FieldError message={error} />
            {existing && (
              <div className="rounded-xl border border-mkt-rule bg-mkt-paper px-3.5 py-3 text-sm text-mkt-ink" data-testid="signup-email-exists">
                There's already an account for <strong>{existing}</strong>.{" "}
                <button type="button" className={TEXT_BUTTON} onClick={() => onSignIn(existing)} data-testid="button-signup-exists-signin">
                  Sign in instead
                </button>
              </div>
            )}
            <Button type="submit" className={SUBMIT} disabled={loading} data-testid="button-signup-continue">
              {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Continue
            </Button>
            <p className="text-center text-[13px] text-mkt-ink-soft" data-testid="text-signup-free">Free account · No credit card to sign up</p>
          </form>

          <div className="text-center text-[13px]">
            <button type="button" onClick={() => onSignIn(normalizeSignupEmail(email) ?? "")} className={TEXT_BUTTON} data-testid="link-goto-login">
              Already have an account? Sign in
            </button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <div className="space-y-1">
            <h1 className={FORM_TITLE} data-testid="text-form-title">About your business</h1>
            <p className={FORM_LEDE}>So we can set things up for your trade.</p>
          </div>
          <form onSubmit={submitAnswers} className="space-y-3.5" noValidate>
            <BusinessQuestions answers={answers} onChange={(next) => { setAnswers(next); setError(""); }} />
            <FieldError message={error} />
            <Button type="submit" className={SUBMIT} disabled={loading} data-testid="button-signup-details">
              {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Continue
            </Button>
          </form>
        </>
      )}

      {step === 3 && (
        <>
          <div className="space-y-1">
            <h1 className={FORM_TITLE} data-testid="text-form-title">Create your password</h1>
            <p className={FORM_LEDE}>For <strong className="text-mkt-ink">{normalizeSignupEmail(email)}</strong></p>
          </div>
          <form onSubmit={createAccount} className="space-y-4" noValidate>
            {/* The username field lets password managers save the login against the right email. */}
            <input type="email" name="email" autoComplete="username" value={normalizeSignupEmail(email) ?? ""} readOnly hidden />
            <div className="space-y-2">
              <Label htmlFor="signup-password" className={FIELD_LABEL}>Password</Label>
              <div className="relative">
                <Lock className={FIELD_ICON} />
                <Input
                  id="signup-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(""); }}
                  placeholder="At least 8 characters"
                  className={`${FIELD} pl-10 pr-10`}
                  data-testid="input-signup-password"
                />
                <PasswordToggle shown={showPassword} onToggle={() => setShowPassword(!showPassword)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="signup-company" className={FIELD_LABEL}>Company name <span className="normal-case tracking-normal font-normal text-mkt-muted">(optional)</span></Label>
              <div className="relative">
                <Building2 className={FIELD_ICON} />
                <Input
                  id="signup-company"
                  autoComplete="organization"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Smith Roofing LLC"
                  className={`${FIELD} pl-10`}
                  maxLength={200}
                  data-testid="input-signup-company"
                />
              </div>
            </div>
            <label className="flex items-start gap-2.5 text-[13px] leading-relaxed text-mkt-ink-soft cursor-pointer">
              <input type="checkbox" checked={agreed} onChange={(e) => { setAgreed(e.target.checked); setError(""); }} className="mt-0.5 h-4 w-4 shrink-0 accent-primary" data-testid="checkbox-agree-terms" />
              <span>I agree to the <a href={termsHref} target="_blank" rel="noopener noreferrer" className={INLINE_LINK} data-testid="link-signup-terms">Terms of Use</a> and <a href={privacyHref} target="_blank" rel="noopener noreferrer" className={INLINE_LINK} data-testid="link-signup-privacy">Privacy Policy</a></span>
            </label>
            <FieldError message={error} />
            <Button type="submit" className={SUBMIT} disabled={loading} data-testid="button-signup">
              {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Create my account
            </Button>
          </form>
        </>
      )}
    </div>
  );
}

/** "Step 2 of 3", three segments, and Back from step 2 on. */
function StepHeader({ step, onBack }: { step: SignupStep; onBack?: () => void }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 min-h-[20px]">
        {onBack ? (
          <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-mkt-muted hover:text-mkt-ink transition-colors" data-testid="button-signup-back">
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </button>
        ) : <span />}
        <span className="text-[12px] font-semibold uppercase tracking-[0.12em] text-mkt-muted" data-testid="text-signup-progress">Step {step} of 3</span>
      </div>
      <div className="grid grid-cols-3 gap-1.5" role="progressbar" aria-valuemin={1} aria-valuemax={3} aria-valuenow={step} aria-label={`Step ${step} of 3`}>
        {[1, 2, 3].map((n) => (
          <span key={n} className={`h-1.5 rounded-full ${n <= step ? "bg-mkt-orange" : "bg-mkt-rule"}`} />
        ))}
      </div>
    </div>
  );
}

/** Step 2's questions; the Google follow-up ("Finish setting up") asks the same ones. */
function BusinessQuestions({ answers, onChange }: { answers: BusinessAnswers; onChange: (next: BusinessAnswers) => void }) {
  const set = (patch: Partial<BusinessAnswers>) => onChange({ ...answers, ...patch });
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="signup-first" className={FIELD_LABEL}>First name</Label>
          <Input id="signup-first" autoComplete="given-name" value={answers.firstName} onChange={(e) => set({ firstName: e.target.value })} className={FIELD} maxLength={100} data-testid="input-signup-first-name" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="signup-last" className={FIELD_LABEL}>Last name</Label>
          <Input id="signup-last" autoComplete="family-name" value={answers.lastName} onChange={(e) => set({ lastName: e.target.value })} className={FIELD} maxLength={100} data-testid="input-signup-last-name" />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="signup-phone" className={FIELD_LABEL}>Mobile phone</Label>
        <div className="relative">
          <Phone className={FIELD_ICON} />
          <Input
            id="signup-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            value={answers.phone}
            onChange={(e) => set({ phone: formatUsPhoneInput(e.target.value) })}
            placeholder="(555) 123-4567"
            className={`${FIELD} pl-10`}
            data-testid="input-signup-phone"
          />
        </div>
      </div>
      <fieldset>
        <legend className={`${FIELD_LABEL} mb-2`}>Your trade</legend>
        <div className="flex flex-wrap gap-1.5">
          {SIGNUP_TRADES.map((t) => (
            <Chip key={t.value} selected={answers.trade === t.value} onClick={() => set({ trade: t.value })} testId={`chip-trade-${t.value}`}>{t.label}</Chip>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className={`${FIELD_LABEL} mb-2`}>Team size</legend>
        <div className="grid grid-cols-4 gap-1.5">
          {SIGNUP_TEAM_SIZES.map((t) => (
            <Chip key={t.value} selected={answers.teamSize === t.value} onClick={() => set({ teamSize: t.value })} testId={`chip-team-${t.value}`}>{t.label}</Chip>
          ))}
        </div>
      </fieldset>
    </>
  );
}

function Chip({ selected, onClick, testId, children }: { selected: boolean; onClick: () => void; testId: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      data-testid={testId}
      className={`h-8 px-2.5 sm:h-9 sm:px-3 rounded-full border text-[13px] sm:text-[14px] font-semibold whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mkt-orange ${
        selected ? "border-mkt-orange bg-mkt-orange text-white" : "border-mkt-rule bg-mkt-paper text-mkt-ink hover:border-mkt-ink"
      }`}
    >
      {children}
    </button>
  );
}

function FieldError({ message }: { message: string }) {
  if (!message) return null;
  return <p role="alert" className="text-[13px] font-semibold text-destructive" data-testid="text-signup-error">{message}</p>;
}

/** A brand-new Google account's one-time "About your business" (server/auth.ts sends it here, then on to `next`). */
function FinishSetup({ user, nextParam }: { user: any; nextParam: string | null }) {
  const [, setLocation] = useLocation();
  const [answers, setAnswers] = useState<BusinessAnswers>(NO_ANSWERS);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const named = useRef(false);
  useEffect(() => {
    // Start from the name Google sent; they can correct it.
    if (!user || named.current) return;
    named.current = true;
    const [first = "", ...rest] = String(user.displayName ?? "").trim().split(/\s+/);
    setAnswers((a) => ({ ...a, firstName: first, lastName: rest.join(" ") }));
  }, [user]);
  const done = () => setLocation(nextParam ?? "/");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseSignupDetails(answers);
    if (!parsed.ok) { setError(parsed.message); return; }
    setLoading(true);
    try {
      await apiRequest("POST", "/api/auth/finish-setup", parsed.details);
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      done();
    } catch (err: any) {
      setError(apiErrorMessage(err, "Could not save. Please try again."));
    } finally {
      setLoading(false);
    }
  };

  if (user === null) {
    return (
      <div className="space-y-3 text-center py-4">
        <h1 className={FORM_TITLE}>Sign in first</h1>
        <a href="/auth" className={TEXT_BUTTON}>Go to sign in</a>
      </div>
    );
  }
  return (
    <div className="space-y-5" data-testid="finish-setup">
      <div className="space-y-1">
        <h1 className={FORM_TITLE} data-testid="text-form-title">Finish setting up</h1>
        <p className={FORM_LEDE}>A few quick questions so we can set things up for your trade.</p>
      </div>
      <form onSubmit={submit} className="space-y-3.5" noValidate>
        <BusinessQuestions answers={answers} onChange={(next) => { setAnswers(next); setError(""); }} />
        <FieldError message={error} />
        <Button type="submit" className={SUBMIT} disabled={loading || !user} data-testid="button-finish-setup">
          {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
          Continue
        </Button>
      </form>
    </div>
  );
}

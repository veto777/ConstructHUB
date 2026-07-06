import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useQuery } from "@tanstack/react-query";
import { Mail, Lock, User, Loader2, ArrowLeft, Eye, EyeOff } from "lucide-react";
import { CHLogo } from "@/components/ch-logo";

type AuthMode = "login" | "signup" | "forgot-password" | "reset-password";

export default function AuthPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const { data: user } = useQuery<any>({
    queryKey: ["/api/auth/me"],
  });

  useEffect(() => {
    if (user) setLocation("/");
  }, [user, setLocation]);

  const params = new URLSearchParams(window.location.search);
  const errorParam = params.get("error");
  const modeParam = params.get("mode");
  const tokenParam = params.get("token");

  const initialMode: AuthMode =
    modeParam === "reset-password" && tokenParam ? "reset-password" :
    modeParam === "forgot-password" ? "forgot-password" :
    modeParam === "signup" ? "signup" : "login";

  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  useEffect(() => {
    if (errorParam === "invalid-token") {
      toast({ title: "Invalid link", description: "The verification link is invalid or has already been used.", variant: "destructive" });
    } else if (errorParam === "token-expired") {
      toast({ title: "Link expired", description: "The verification link has expired. Please request a new one.", variant: "destructive" });
    } else if (errorParam === "google-failed") {
      toast({ title: "Google login failed", description: "Could not sign in with Google. Please try again.", variant: "destructive" });
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
      });
      const data = await res.json();
      setMessage(data.message);
      toast({ title: "Account created!", description: "Check your email for a verification link." });
    } catch (err: any) {
      const msg = err.message || "Signup failed";
      toast({ title: "Signup failed", description: msg, variant: "destructive" });
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
      await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      setLocation("/");
    } catch (err: any) {
      const msg = err.message || "Login failed";
      if (msg.includes("verify your email")) {
        setMessage(msg);
      }
      toast({ title: "Login failed", description: msg, variant: "destructive" });
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
      setMode("login");
      setPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      toast({ title: "Reset failed", description: err.message || "Could not reset password.", variant: "destructive" });
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

  return (
    <div className="min-h-screen flex items-start sm:items-center justify-center bg-background p-4 overflow-y-auto py-8">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="flex justify-center">
            <CHLogo height={50} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-auth-title">Construct<span className="font-extrabold">HUB</span></h1>
          <p className="text-sm text-muted-foreground">Nationwide Contractor Services</p>
        </div>

        <Card className="p-6 space-y-5" style={{ boxShadow: "var(--shadow-sm)" }}>
          {mode === "login" && (
            <>
              <div className="space-y-1">
                <h2 className="text-lg font-semibold" data-testid="text-form-title">Welcome back</h2>
                <p className="text-sm text-muted-foreground">Sign in to your account</p>
              </div>

              <a href="/api/auth/google" data-testid="link-google-login">
                <Button variant="outline" className="w-full gap-2" type="button">
                  <svg className="h-4 w-4" viewBox="0 0 24 24">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                  </svg>
                  Continue with Google
                </Button>
              </a>

              <div className="relative">
                <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
                <div className="relative flex justify-center text-xs"><span className="bg-card px-2 text-muted-foreground">or</span></div>
              </div>

              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="login-email" className="text-xs">Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="login-email"
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="pl-9"
                      required
                      data-testid="input-login-email"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="login-password" className="text-xs">Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="login-password"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="Enter your password"
                      className="pl-9 pr-9"
                      required
                      data-testid="input-login-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <Button type="submit" className="w-full" disabled={loading} data-testid="button-login">
                  {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                  Sign In
                </Button>
              </form>

              {message && message.includes("verify") && (
                <div className="text-center">
                  <Button variant="link" size="sm" className="text-xs" onClick={handleResendVerification} data-testid="button-resend-verification">
                    Resend verification email
                  </Button>
                </div>
              )}

              <div className="flex items-center justify-between text-xs">
                <button
                  type="button"
                  onClick={() => { setMode("forgot-password"); setMessage(""); }}
                  className="text-primary hover:underline"
                  data-testid="link-forgot-password"
                >
                  Forgot password?
                </button>
                <button
                  type="button"
                  onClick={() => { setMode("signup"); setMessage(""); }}
                  className="text-primary hover:underline"
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
                <h2 className="text-lg font-semibold" data-testid="text-form-title">Create your account</h2>
                <p className="text-sm text-muted-foreground">Get started with Construction HUB</p>
              </div>

              <a href="/api/auth/google" data-testid="link-google-signup">
                <Button variant="outline" className="w-full gap-2" type="button">
                  <svg className="h-4 w-4" viewBox="0 0 24 24">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                  </svg>
                  Sign up with Google
                </Button>
              </a>

              <div className="relative">
                <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
                <div className="relative flex justify-center text-xs"><span className="bg-card px-2 text-muted-foreground">or</span></div>
              </div>

              {message ? (
                <div className="text-center space-y-3 py-4">
                  <div className="flex justify-center">
                    <Mail className="h-10 w-10 text-primary" />
                  </div>
                  <p className="text-sm font-medium">Check your email</p>
                  <p className="text-xs text-muted-foreground">{message}</p>
                  <Button variant="link" size="sm" className="text-xs" onClick={handleResendVerification} data-testid="button-resend-signup">
                    Resend verification email
                  </Button>
                </div>
              ) : (
                <form onSubmit={handleSignup} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="signup-name" className="text-xs">Full Name</Label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="signup-name"
                        type="text"
                        value={displayName}
                        onChange={e => setDisplayName(e.target.value)}
                        placeholder="John Doe"
                        className="pl-9"
                        data-testid="input-signup-name"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-email" className="text-xs">Email</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="signup-email"
                        type="email"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        placeholder="you@example.com"
                        className="pl-9"
                        required
                        data-testid="input-signup-email"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-password" className="text-xs">Password</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="signup-password"
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        placeholder="At least 8 characters"
                        className="pl-9 pr-9"
                        required
                        data-testid="input-signup-password"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-confirm" className="text-xs">Confirm Password</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="signup-confirm"
                        type={showPassword ? "text" : "password"}
                        value={confirmPassword}
                        onChange={e => setConfirmPassword(e.target.value)}
                        placeholder="Confirm your password"
                        className="pl-9"
                        required
                        data-testid="input-signup-confirm"
                      />
                    </div>
                  </div>
                  <label className="flex items-start gap-2 text-xs text-muted-foreground cursor-pointer">
                    <input type="checkbox" checked={agreedToTerms} onChange={e => setAgreedToTerms(e.target.checked)} className="mt-0.5 accent-primary" data-testid="checkbox-agree-terms" />
                    <span>I agree to the <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline" data-testid="link-signup-terms">Terms of Use</a> and <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline" data-testid="link-signup-privacy">Privacy Policy</a></span>
                  </label>
                  <Button type="submit" className="w-full" disabled={loading || !agreedToTerms} data-testid="button-signup">
                    {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                    Create Account
                  </Button>
                </form>
              )}

              <div className="text-center text-xs">
                <button
                  type="button"
                  onClick={() => { setMode("login"); setMessage(""); }}
                  className="text-primary hover:underline"
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
                  onClick={() => { setMode("login"); setMessage(""); }}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-2"
                >
                  <ArrowLeft className="h-3 w-3" /> Back to login
                </button>
                <h2 className="text-lg font-semibold">Reset your password</h2>
                <p className="text-sm text-muted-foreground">Enter your email and we'll send you a reset link</p>
              </div>

              {message ? (
                <div className="text-center space-y-3 py-4">
                  <Mail className="h-10 w-10 text-primary mx-auto" />
                  <p className="text-sm font-medium">Check your email</p>
                  <p className="text-xs text-muted-foreground">{message}</p>
                </div>
              ) : (
                <form onSubmit={handleForgotPassword} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="forgot-email" className="text-xs">Email</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="forgot-email"
                        type="email"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        placeholder="you@example.com"
                        className="pl-9"
                        required
                        data-testid="input-forgot-email"
                      />
                    </div>
                  </div>
                  <Button type="submit" className="w-full" disabled={loading} data-testid="button-send-reset">
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
                <h2 className="text-lg font-semibold">Set new password</h2>
                <p className="text-sm text-muted-foreground">Choose a new password for your account</p>
              </div>

              <form onSubmit={handleResetPassword} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="reset-password" className="text-xs">New Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="reset-password"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="At least 8 characters"
                      className="pl-9 pr-9"
                      required
                      data-testid="input-reset-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reset-confirm" className="text-xs">Confirm Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="reset-confirm"
                      type={showPassword ? "text" : "password"}
                      value={confirmPassword}
                      onChange={e => setConfirmPassword(e.target.value)}
                      placeholder="Confirm your password"
                      className="pl-9"
                      required
                      data-testid="input-reset-confirm"
                    />
                  </div>
                </div>
                <Button type="submit" className="w-full" disabled={loading} data-testid="button-reset-password">
                  {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                  Reset Password
                </Button>
              </form>
            </>
          )}
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          By signing up, you agree to our terms of service and privacy policy.
        </p>
      </div>
    </div>
  );
}

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle, Copy, Eye, EyeOff, Globe, Lock, Shield, ShieldCheck } from "lucide-react";
import { SecurityActivity } from "@/components/account-security";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage, queryClient } from "@/lib/queryClient";
import { copyToClipboard } from "./shared";
import type { SettingsSectionProps, SettingsUser } from "./types";

/**
 * Me → Password & security: change the password, two-factor sign-in, and the
 * existing security panel (remembered devices, "wasn't you?" remediation and
 * recent account activity). The full, filterable history is the Audit log.
 */
export function PasswordSecuritySection({ user }: SettingsSectionProps) {
  return (
    <div className="space-y-6" data-testid="section-security">
      {user?.hasPassword ? (
        <ChangePasswordCard />
      ) : user ? (
        <Card data-testid="card-no-password">
          <CardHeader>
            <CardTitle className="text-base">Password</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground flex items-start gap-2" data-testid="text-no-password">
              <Globe className="h-4 w-4 mt-0.5 shrink-0" />
              {user.googleId
                ? "You sign in with Google, so this account has no ConstructHUB password to change."
                : "This account has no password set, so there is nothing to change here."}
            </p>
          </CardContent>
        </Card>
      ) : null}
      <TwoFactorSection user={user} />
      <SecurityActivity />
    </div>
  );
}

function ChangePasswordCard() {
  const { toast } = useToast();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);

  const changePasswordMutation = useMutation({
    mutationFn: async () => {
      if (newPassword !== confirmPassword) throw new Error("Passwords don't match");
      if (newPassword.length < 8) throw new Error("Password must be at least 8 characters");
      const res = await apiRequest("POST", "/api/auth/change-password", { currentPassword, newPassword });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Password changed successfully" });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    },
    onError: (err: any) => {
      toast({ title: "Failed to change password", description: apiErrorMessage(err), variant: "destructive" });
    },
  });

  return (
    <Card data-testid="card-change-password">
      <CardHeader>
        <CardTitle className="text-base">Change Password</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="currentPassword">Current password</Label>
          <div className="relative">
            <Input
              id="currentPassword"
              type={showCurrentPassword ? "text" : "password"}
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              placeholder="Enter current password"
              autoComplete="current-password"
              data-testid="input-current-password"
            />
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={showCurrentPassword ? "Hide current password" : "Show current password"}
              onClick={() => setShowCurrentPassword(!showCurrentPassword)}
            >
              {showCurrentPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="newPassword">New password</Label>
          <div className="relative">
            <Input
              id="newPassword"
              type={showNewPassword ? "text" : "password"}
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder="Enter new password (min 8 characters)"
              autoComplete="new-password"
              data-testid="input-new-password"
            />
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={showNewPassword ? "Hide new password" : "Show new password"}
              onClick={() => setShowNewPassword(!showNewPassword)}
            >
              {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirmPassword">Confirm new password</Label>
          <Input
            id="confirmPassword"
            type="password"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            placeholder="Confirm new password"
            autoComplete="new-password"
            data-testid="input-confirm-password"
          />
        </div>
        <div className="flex justify-end">
          <Button
            onClick={() => changePasswordMutation.mutate()}
            disabled={!currentPassword || !newPassword || !confirmPassword || changePasswordMutation.isPending}
            data-testid="button-change-password"
          >
            <Lock className="h-4 w-4 mr-2" />
            {changePasswordMutation.isPending ? "Updating..." : "Update password"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function TwoFactorSection({ user }: { user: SettingsUser | undefined }) {
  const { toast } = useToast();
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [setupData, setSetupData] = useState<{ secret: string; qrCode: string } | null>(null);
  const [verifyCode, setVerifyCode] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [showDisable, setShowDisable] = useState(false);

  const setupMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/auth/2fa/setup");
      return res.json();
    },
    onSuccess: (data: any) => {
      setSetupData({ secret: data.secret, qrCode: data.qrCode });
    },
    onError: (err: any) => {
      toast({ title: "Failed to start 2FA setup", description: apiErrorMessage(err), variant: "destructive" });
    },
  });

  const verifyMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/auth/2fa/verify", { code: verifyCode });
      return res.json();
    },
    onSuccess: (data: any) => {
      setRecoveryCodes(data.codes || []);
      toast({ title: "Two-factor authentication enabled!" });
      setSetupData(null);
      setVerifyCode("");
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
    onError: (err: any) => {
      toast({ title: "Couldn't enable 2FA", description: apiErrorMessage(err, "Invalid code"), variant: "destructive" });
    },
  });

  const disableMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/auth/2fa/disable", { code: disableCode });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Two-factor authentication disabled" });
      setDisableCode("");
      setShowDisable(false);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
    onError: (err: any) => {
      toast({ title: "Couldn't disable 2FA", description: apiErrorMessage(err, "Invalid code"), variant: "destructive" });
    },
  });

  const is2FAEnabled = !!user?.totpEnabled;

  return (
    <Card data-testid="card-two-factor">
      <CardHeader>
        <CardTitle className="text-base">Two-Factor Authentication</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {recoveryCodes.length > 0 && (
          <div role="status" className="space-y-2">
            <p>Save these recovery codes now. Each works once; they will not be shown again.</p>
            <pre className="select-all rounded-md bg-muted p-3 text-xs">{recoveryCodes.join("\n")}</pre>
            <Button variant="outline" onClick={() => setRecoveryCodes([])}>I saved my codes</Button>
          </div>
        )}
        {is2FAEnabled && (
          <Button
            variant="outline"
            onClick={async () => {
              try {
                const r = await apiRequest("POST", "/api/auth/2fa/recovery-codes");
                setRecoveryCodes((await r.json()).codes);
              } catch (e: any) {
                toast({ title: "Couldn't generate recovery codes", description: apiErrorMessage(e), variant: "destructive" });
              }
            }}
          >
            Generate new recovery codes
          </Button>
        )}
        {is2FAEnabled && !showDisable && (
          <div className="space-y-3">
            <div className="flex items-center gap-3 p-3 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-lg">
              <ShieldCheck className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              <div>
                <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">2FA is enabled</p>
                <p className="text-xs text-emerald-600 dark:text-emerald-400">Your account is protected with an authenticator app.</p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive border-destructive/20 hover:bg-destructive/5"
              onClick={() => setShowDisable(true)}
              data-testid="button-disable-2fa"
            >
              Disable 2FA
            </Button>
          </div>
        )}

        {is2FAEnabled && showDisable && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Enter a code from your authenticator app to disable 2FA.</p>
            <div className="flex flex-wrap gap-2">
              <Input
                value={disableCode}
                onChange={e => setDisableCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="6-digit code"
                className="max-w-[160px] font-mono text-center tracking-widest"
                maxLength={6}
                aria-label="Authenticator code to disable 2FA"
                data-testid="input-disable-2fa-code"
              />
              <Button
                onClick={() => disableMutation.mutate()}
                disabled={disableCode.length !== 6 || disableMutation.isPending}
                variant="destructive"
                size="sm"
                data-testid="button-confirm-disable-2fa"
              >
                {disableMutation.isPending ? "Verifying..." : "Confirm Disable"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { setShowDisable(false); setDisableCode(""); }} data-testid="button-cancel-disable-2fa">
                Cancel
              </Button>
            </div>
          </div>
        )}

        {!is2FAEnabled && !setupData && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">Enhance your account security</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Add an extra layer of security by requiring a verification code when signing in.
              </p>
            </div>
            <Button
              onClick={() => setupMutation.mutate()}
              disabled={setupMutation.isPending}
              size="sm"
              data-testid="button-enable-2fa"
            >
              <Shield className="h-4 w-4 mr-2" />
              {setupMutation.isPending ? "Setting up..." : "Enable 2FA"}
            </Button>
          </div>
        )}

        {!is2FAEnabled && setupData && (
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm font-medium">1. Scan the QR code with your authenticator app</p>
              <p className="text-xs text-muted-foreground">Use Google Authenticator, Authy, or any TOTP-compatible app.</p>
              <div className="flex justify-center p-4 bg-white rounded-lg border">
                <img src={setupData.qrCode} alt="2FA QR Code" className="w-48 h-48" data-testid="img-2fa-qr" />
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">Or enter this key manually</p>
              <div className="flex items-center gap-2">
                <code className="text-xs bg-muted px-3 py-2 rounded font-mono select-all break-all" data-testid="text-2fa-secret">
                  {setupData.secret}
                </code>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Copy secret key"
                  onClick={async () => {
                    if (await copyToClipboard(setupData.secret)) toast({ title: "Secret key copied" });
                    else toast({ title: "Couldn't copy the key", description: "Your browser blocked clipboard access. Select the key shown here and copy it manually.", variant: "destructive" });
                  }}
                  data-testid="button-copy-2fa-secret"
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">2. Enter the 6-digit code from your app to verify</p>
              <div className="flex flex-wrap gap-2">
                <Input
                  value={verifyCode}
                  onChange={e => setVerifyCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="6-digit code"
                  className="max-w-[160px] font-mono text-center tracking-widest"
                  maxLength={6}
                  aria-label="Authenticator code"
                  data-testid="input-verify-2fa-code"
                />
                <Button
                  onClick={() => verifyMutation.mutate()}
                  disabled={verifyCode.length !== 6 || verifyMutation.isPending}
                  data-testid="button-verify-2fa"
                >
                  <CheckCircle className="h-4 w-4 mr-2" />
                  {verifyMutation.isPending ? "Verifying..." : "Verify & Enable"}
                </Button>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => { setSetupData(null); setVerifyCode(""); }} data-testid="button-cancel-2fa-setup">
              Cancel Setup
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

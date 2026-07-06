import { useState, useRef, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  FileText, CheckCircle2, Clock, AlertTriangle, Shield, Loader2,
  Calendar, DollarSign, Building2, PenLine, ArrowRight, XCircle,
  Scale, CreditCard, Mail
} from "lucide-react";

function generateContractText(data: any) {
  const monthlyStr = `$${(data.monthlyPrice / 100).toLocaleString()}`;
  const totalStr = `$${(data.totalPrice / 100).toLocaleString()}`;
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  return {
    title: "DIGITAL MARKETING SERVICES AGREEMENT",
    sections: [
      {
        heading: "1. PARTIES",
        content: `This Digital Marketing Services Agreement ("Agreement") is entered into as of ${today} ("Effective Date"), by and between:\n\nConstructHUB, LLC ("Company" or "Provider"), a digital marketing services company, with its principal place of business at the address on file;\n\nand\n\nThe undersigned client ("Client"), whose identity is verified via the email address associated with this agreement: ${data.email}.`
      },
      {
        heading: "2. SCOPE OF SERVICES",
        content: `Provider agrees to perform the following Search Engine Optimization (SEO) services under the "${data.packageName}" package:\n\n• Comprehensive website audit and technical SEO analysis\n• On-page optimization including meta tags, headers, content structure, and internal linking\n• Off-page optimization including backlink acquisition, citation building, and directory submissions\n• Keyword research, mapping, and ongoing rank tracking\n• Monthly performance reporting with analytics dashboards\n• Content strategy recommendations and implementation guidance\n• Google Business Profile optimization (where applicable)\n• Competitor analysis and market positioning strategy\n\nThe specific deliverables and performance targets for the selected package tier are defined in the service documentation provided at the time of purchase and are incorporated herein by reference.`
      },
      {
        heading: "3. TERM AND MINIMUM COMMITMENT",
        content: `The initial term of this Agreement shall be six (6) months ("Minimum Term"), commencing on the Effective Date. Client acknowledges and agrees that SEO results require sustained effort over time and that the Minimum Term is essential to allow sufficient time for the services to produce measurable results.\n\nUpon expiration of the Minimum Term, this Agreement shall automatically renew on a month-to-month basis unless either party provides written notice of termination at least thirty (30) days prior to the end of the then-current term.\n\nCLIENT EXPRESSLY ACKNOWLEDGES THAT THE MINIMUM TERM IS A MATERIAL CONDITION OF THIS AGREEMENT AND THAT EARLY TERMINATION FEES SHALL APPLY AS SET FORTH IN SECTION 6.`
      },
      {
        heading: "4. FEES AND PAYMENT",
        content: `Client agrees to pay the following fees:\n\n• Monthly Service Fee: ${monthlyStr} per month\n• Total Minimum Commitment: ${totalStr} (${monthlyStr} × ${data.termMonths} months)\n• Payment Method: Credit card, debit card, or ACH bank transfer (for totals $5,000+)\n• Billing Cycle: Monthly, charged on the same date each month as the Effective Date\n• Currency: United States Dollars (USD)\n\nAll fees are non-refundable once the billing cycle has begun. Payment is due in advance at the beginning of each monthly billing cycle. Provider reserves the right to suspend services if payment is not received within five (5) business days of the due date.\n\nA one-point-five percent (1.5%) monthly late fee (18% per annum) shall be applied to all past-due balances. Client shall be responsible for all costs of collection, including reasonable attorneys' fees and court costs.`
      },
      {
        heading: "5. NO GUARANTEE OF RESULTS",
        content: `Client acknowledges that SEO is subject to factors beyond Provider's control, including but not limited to search engine algorithm changes, competitor actions, website technical issues controlled by Client, and market conditions. Provider does not guarantee specific rankings, traffic levels, or conversion rates.\n\nProvider commits to applying industry best practices and dedicating the professional resources necessary to pursue the agreed-upon objectives. Performance targets, where stated in the package description, represent goals based on historical data and professional judgment, not binding guarantees.\n\nAny representations regarding expected results are estimates only and shall not constitute warranties or guarantees of performance.`
      },
      {
        heading: "6. EARLY TERMINATION AND PENALTIES",
        content: `If Client terminates this Agreement prior to the expiration of the Minimum Term for any reason other than Provider's material breach, Client shall be liable for and agrees to immediately pay:\n\n(a) ALL remaining monthly payments due for the balance of the Minimum Term ("Early Termination Fee"). For example, if Client cancels after 2 months, Client owes the remaining 4 months (${monthlyStr} × 4 = $${((data.monthlyPrice / 100) * 4).toLocaleString()}).\n\n(b) Any outstanding balances, late fees, or unpaid invoices.\n\n(c) Reasonable collection costs and legal fees incurred to enforce this provision.\n\nClient authorizes Provider to charge the Early Termination Fee to the payment method on file. If the payment method on file is declined, Client agrees to remit payment within ten (10) business days of written notice.\n\nIF CLIENT FAILS TO PAY THE EARLY TERMINATION FEE, THE UNPAID BALANCE MAY BE REFERRED TO A THIRD-PARTY COLLECTIONS AGENCY AND/OR REPORTED TO CREDIT BUREAUS. CLIENT AGREES THAT SUCH ACTIONS ARE A REASONABLE AND NECESSARY REMEDY.`
      },
      {
        heading: "7. COLLECTIONS AND ENFORCEMENT",
        content: `In the event Client fails to pay any amounts owed under this Agreement, including but not limited to monthly fees, early termination fees, or late charges:\n\n(a) The outstanding balance shall accrue interest at the rate of 1.5% per month (18% annually) from the date the payment was originally due.\n\n(b) Provider may, at its sole discretion, refer the delinquent account to a professional collections agency. Client shall be responsible for all costs associated with collection efforts, including agency fees, which may add up to 40% to the outstanding balance.\n\n(c) Provider may report the delinquent account to one or more commercial credit reporting agencies.\n\n(d) Provider may pursue legal action in a court of competent jurisdiction to recover the full amount owed plus costs, attorneys' fees, and interest.\n\nClient waives any right to contest the validity of this debt once the Agreement has been executed and services have commenced.`
      },
      {
        heading: "8. DISPUTE RESOLUTION AND ARBITRATION",
        content: `Any dispute, claim, or controversy arising out of or relating to this Agreement, or the breach, termination, enforcement, interpretation, or validity thereof, including the determination of the scope or applicability of this agreement to arbitrate, shall be determined by binding arbitration.\n\nArbitration shall be administered by the American Arbitration Association ("AAA") in accordance with its Commercial Arbitration Rules. The arbitration shall take place in the state where Provider's principal office is located, or at a mutually agreed location, or via videoconference.\n\nThe arbitrator's decision shall be final and binding and may be entered as a judgment in any court of competent jurisdiction. The prevailing party shall be entitled to recover its reasonable attorneys' fees, costs, and expenses from the non-prevailing party.\n\nCLIENT ACKNOWLEDGES THAT BY AGREEING TO ARBITRATION, CLIENT IS WAIVING THE RIGHT TO A JURY TRIAL AND THE RIGHT TO PARTICIPATE IN A CLASS ACTION LAWSUIT.`
      },
      {
        heading: "9. LIMITATION OF LIABILITY",
        content: `IN NO EVENT SHALL PROVIDER'S TOTAL LIABILITY TO CLIENT FOR ALL DAMAGES, LOSSES, AND CAUSES OF ACTION EXCEED THE TOTAL AMOUNT PAID BY CLIENT TO PROVIDER DURING THE SIX (6) MONTH PERIOD IMMEDIATELY PRECEDING THE EVENT GIVING RISE TO THE CLAIM.\n\nIN NO EVENT SHALL PROVIDER BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING BUT NOT LIMITED TO LOSS OF PROFITS, LOSS OF DATA, LOSS OF BUSINESS OPPORTUNITIES, OR BUSINESS INTERRUPTION, REGARDLESS OF WHETHER SUCH DAMAGES WERE FORESEEABLE OR WHETHER PROVIDER WAS ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.`
      },
      {
        heading: "10. CLIENT RESPONSIBILITIES",
        content: `Client agrees to:\n\n(a) Provide timely access to website administrative panels, hosting accounts, analytics tools, and any other platforms necessary for Provider to perform the services.\n\n(b) Review and approve content, strategies, and recommendations within five (5) business days of submission. Failure to respond shall be deemed approval.\n\n(c) Not engage in any practices that may negatively impact SEO performance, including but not limited to purchasing low-quality backlinks, keyword stuffing, cloaking, or other "black hat" techniques.\n\n(d) Notify Provider within 48 hours of any material changes to the website, business operations, or marketing strategy that may affect the services.\n\n(e) Maintain accurate and up-to-date business information across all online platforms.`
      },
      {
        heading: "11. INTELLECTUAL PROPERTY",
        content: `All SEO strategies, processes, methodologies, tools, and proprietary techniques used by Provider remain the exclusive intellectual property of Provider. Client is granted a non-exclusive, non-transferable license to use the deliverables solely for Client's business during and after the term of this Agreement.\n\nContent created specifically for Client (blog posts, landing pages, meta descriptions) shall become Client's property upon full payment for the month in which such content was created.\n\nClient grants Provider a limited license to use Client's name, logo, and website in Provider's portfolio and marketing materials unless Client provides written notice to the contrary.`
      },
      {
        heading: "12. CONFIDENTIALITY",
        content: `Each party agrees to hold in confidence all proprietary and confidential information of the other party disclosed during the term of this Agreement. Confidential information includes but is not limited to business strategies, financial data, customer lists, marketing plans, and trade secrets.\n\nThis obligation of confidentiality shall survive the termination of this Agreement for a period of two (2) years.`
      },
      {
        heading: "13. GOVERNING LAW",
        content: `This Agreement shall be governed by and construed in accordance with the laws of the State in which Provider's principal office is located, without regard to its conflict of laws principles.\n\nAny legal action not subject to arbitration under Section 8 shall be brought exclusively in the state or federal courts located in the jurisdiction of Provider's principal office.`
      },
      {
        heading: "14. ENTIRE AGREEMENT AND AMENDMENTS",
        content: `This Agreement, together with any exhibits, schedules, or addenda attached hereto, constitutes the entire agreement between the parties with respect to the subject matter hereof and supersedes all prior agreements, representations, warranties, and understandings, whether written, oral, or implied.\n\nNo amendment or modification of this Agreement shall be valid or binding unless in writing and signed by both parties. No waiver of any provision of this Agreement shall be deemed a continuing waiver or a waiver of any other provision.`
      },
      {
        heading: "15. ELECTRONIC SIGNATURE AND ACKNOWLEDGMENT",
        content: `By typing your full legal name and clicking "Sign Contract" below, you acknowledge that:\n\n(a) You have read, understood, and agree to be bound by all terms and conditions of this Agreement.\n\n(b) Your electronic signature is legally binding and has the same legal effect as a handwritten signature pursuant to the Electronic Signatures in Global and National Commerce Act (E-SIGN Act) and the Uniform Electronic Transactions Act (UETA).\n\n(c) You are authorized to enter into this Agreement on behalf of yourself or the business entity named herein.\n\n(d) You understand the financial obligations, minimum term commitment, and early termination penalties described herein.\n\n(e) You have had the opportunity to consult with legal counsel prior to executing this Agreement.`
      },
    ],
  };
}

export default function ContractSignPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [signerName, setSignerName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [agreedTerms, setAgreedTerms] = useState(false);
  const [agreedArbitration, setAgreedArbitration] = useState(false);
  const [scrolledToBottom, setScrolledToBottom] = useState(false);
  const contractRef = useRef<HTMLDivElement>(null);

  const urlParams = new URLSearchParams(window.location.search);
  const paymentSuccess = urlParams.get("payment_success");
  const paymentCanceled = urlParams.get("payment_canceled");

  useEffect(() => {
    if (paymentSuccess) {
      toast({ title: "Payment Successful!", description: "Your SEO campaign will begin within 48 hours. Check your email for onboarding details." });
      window.history.replaceState({}, "", window.location.pathname);
    }
    if (paymentCanceled) {
      toast({ title: "Payment Canceled", description: "No charges were made. Your signed contract is still valid — you can complete payment anytime.", variant: "destructive" });
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [paymentSuccess, paymentCanceled]);

  const { data: contract, isLoading, error } = useQuery<any>({
    queryKey: ["/api/contracts", token],
    queryFn: async () => {
      const res = await fetch(`/api/contracts/${token}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to load contract");
      }
      return res.json();
    },
    enabled: !!token,
  });

  const signMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/contracts/${token}/sign`, {
        signerName,
        companyName,
        signatureData: `SIGNED:${signerName}:${new Date().toISOString()}:${navigator.userAgent}`,
        agreedToTerms: agreed,
        agreedToTermination: agreedTerms,
        agreedToArbitration,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Contract Signed!", description: "Your agreement has been executed. You can now proceed to payment." });
    },
    onError: (err: any) => {
      toast({ title: "Signing Failed", description: err.message, variant: "destructive" });
    },
  });

  const checkoutMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/contracts/${token}/checkout`);
      return res.json();
    },
    onSuccess: (data) => {
      if (data.url) window.location.href = data.url;
    },
    onError: (err: any) => {
      toast({ title: "Checkout Failed", description: err.message, variant: "destructive" });
    },
  });

  const handleScroll = () => {
    if (contractRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = contractRef.current;
      if (scrollTop + clientHeight >= scrollHeight - 50) {
        setScrolledToBottom(true);
      }
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
          <p className="text-muted-foreground">Loading contract...</p>
        </div>
      </div>
    );
  }

  if (error || !contract) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="max-w-md mx-auto">
          <CardContent className="p-8 text-center space-y-4">
            <XCircle className="h-12 w-12 text-destructive mx-auto" />
            <h2 className="text-xl font-bold" data-testid="text-contract-error">Contract Not Found</h2>
            <p className="text-muted-foreground text-sm">
              {(error as any)?.message || "This contract link may have expired or is invalid. Please contact support or request a new contract."}
            </p>
            <Button variant="outline" onClick={() => setLocation("/pricing")} data-testid="link-back-pricing">
              Back to Pricing
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const contractText = generateContractText(contract);
  const monthlyStr = `$${(contract.monthlyPrice / 100).toLocaleString()}`;
  const totalStr = `$${(contract.totalPrice / 100).toLocaleString()}`;
  const isSigned = contract.status === "signed";
  const isPending = contract.status === "pending";
  const canSign = isPending && scrolledToBottom && signerName.trim().length >= 2 && agreed && agreedTerms && agreedArbitration;

  return (
    <div className="min-h-screen bg-muted/30">
      <div className="bg-background border-b border-border sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-foreground flex items-center justify-center">
              <Scale className="h-5 w-5 text-background" />
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-tight" data-testid="text-contract-header">ConstructHUB</h1>
              <p className="text-[11px] text-muted-foreground">Legal Document</p>
            </div>
          </div>
          <Badge
            variant={isSigned ? "default" : isPending ? "secondary" : "destructive"}
            className="text-xs"
            data-testid="badge-contract-status"
          >
            {isSigned ? "Signed" : isPending ? "Pending Signature" : contract.status}
          </Badge>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        <Card className="border-foreground/10">
          <CardContent className="p-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="flex items-start gap-3">
                <FileText className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Package</p>
                  <p className="font-semibold text-sm" data-testid="text-contract-package">{contract.packageName}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <DollarSign className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Monthly</p>
                  <p className="font-semibold text-sm" data-testid="text-contract-monthly">{monthlyStr}/mo</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Calendar className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Term</p>
                  <p className="font-semibold text-sm" data-testid="text-contract-term">{contract.termMonths} Months</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <CreditCard className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Total Commitment</p>
                  <p className="font-semibold text-sm" data-testid="text-contract-total">{totalStr}</p>
                </div>
              </div>
            </div>
            <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
              <Mail className="h-3.5 w-3.5" />
              <span data-testid="text-contract-email">Sent to: {contract.email}</span>
              <span className="mx-1">•</span>
              <Clock className="h-3.5 w-3.5" />
              <span>Expires: {new Date(contract.expiresAt).toLocaleDateString()}</span>
            </div>
          </CardContent>
        </Card>

        {isSigned && (
          <Card className="border-green-500/30 bg-green-50 dark:bg-green-950/20">
            <CardContent className="p-6">
              <div className="flex items-start gap-4">
                <CheckCircle2 className="h-8 w-8 text-green-600 shrink-0" />
                <div className="space-y-2">
                  <h3 className="font-bold text-green-800 dark:text-green-300" data-testid="text-contract-signed-title">Contract Signed Successfully</h3>
                  <p className="text-sm text-green-700 dark:text-green-400">
                    Signed by <strong>{contract.signerName}</strong> on {new Date(contract.signedAt).toLocaleString()}
                  </p>
                  {!contract.stripeSessionId && (
                    <div className="pt-2">
                      <Button
                        onClick={() => checkoutMutation.mutate()}
                        disabled={checkoutMutation.isPending}
                        className="bg-green-600 hover:bg-green-700 text-white"
                        data-testid="button-contract-checkout"
                      >
                        {checkoutMutation.isPending ? (
                          <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Processing...</>
                        ) : (
                          <><CreditCard className="h-4 w-4 mr-2" /> Proceed to Payment — {totalStr}</>
                        )}
                      </Button>
                      <p className="text-xs text-green-600 dark:text-green-400 mt-2">
                        {contract.totalPrice >= 500000 ? "Credit card or bank account (ACH) accepted" : "Credit or debit card accepted"}
                      </p>
                    </div>
                  )}
                  {paymentSuccess && (
                    <div className="pt-2 flex items-center gap-2 text-green-700 dark:text-green-300">
                      <CheckCircle2 className="h-5 w-5" />
                      <span className="font-medium" data-testid="text-payment-success">Payment received — your campaign starts within 48 hours!</span>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="p-0">
            <div className="bg-foreground/5 px-6 py-4 border-b flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-muted-foreground" />
                <span className="font-semibold text-sm">Service Agreement</span>
              </div>
              {!scrolledToBottom && isPending && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  Scroll to read full contract
                </span>
              )}
            </div>

            <div
              ref={contractRef}
              onScroll={handleScroll}
              className="max-h-[500px] overflow-y-auto px-6 py-6 space-y-6"
              data-testid="container-contract-text"
            >
              <div className="text-center space-y-1 pb-4 border-b">
                <h2 className="text-lg font-bold tracking-tight">{contractText.title}</h2>
                <p className="text-xs text-muted-foreground">ConstructHUB, LLC — {contract.packageName} Package</p>
              </div>

              {contractText.sections.map((section, idx) => (
                <div key={idx} className="space-y-2">
                  <h3 className="font-bold text-sm text-foreground">{section.heading}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">{section.content}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {isPending && (
          <Card className="border-foreground/10">
            <CardContent className="p-6 space-y-6">
              <div className="flex items-center gap-2 mb-2">
                <PenLine className="h-5 w-5 text-foreground" />
                <h3 className="font-bold text-lg">Sign This Agreement</h3>
              </div>

              {!scrolledToBottom && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-300 text-sm">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>Please scroll through and read the entire contract above before signing.</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="signerName">Full Legal Name *</Label>
                  <Input
                    id="signerName"
                    value={signerName}
                    onChange={(e) => setSignerName(e.target.value)}
                    placeholder="Enter your full legal name"
                    disabled={!scrolledToBottom}
                    data-testid="input-signer-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="companyName">Company Name (optional)</Label>
                  <Input
                    id="companyName"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="Your business/company name"
                    disabled={!scrolledToBottom}
                    data-testid="input-company-name"
                  />
                </div>
              </div>

              <Separator />

              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <Checkbox
                    id="agreed"
                    checked={agreed}
                    onCheckedChange={(c) => setAgreed(!!c)}
                    disabled={!scrolledToBottom}
                    data-testid="checkbox-agree-contract"
                  />
                  <label htmlFor="agreed" className="text-sm leading-relaxed cursor-pointer">
                    I have read and understand the entire Service Agreement above. I agree to the <strong>6-month minimum commitment</strong> of <strong>{monthlyStr}/month</strong> (total {totalStr}) and understand the early termination penalties.
                  </label>
                </div>

                <div className="flex items-start gap-3">
                  <Checkbox
                    id="agreedTerms"
                    checked={agreedTerms}
                    onCheckedChange={(c) => setAgreedTerms(!!c)}
                    disabled={!scrolledToBottom}
                    data-testid="checkbox-agree-terms"
                  />
                  <label htmlFor="agreedTerms" className="text-sm leading-relaxed cursor-pointer">
                    I understand that early cancellation will result in <strong>immediate payment of all remaining months</strong>, and that unpaid balances may be referred to <strong>collections</strong> and reported to credit bureaus.
                  </label>
                </div>

                <div className="flex items-start gap-3">
                  <Checkbox
                    id="agreedArbitration"
                    checked={agreedArbitration}
                    onCheckedChange={(c) => setAgreedArbitration(!!c)}
                    disabled={!scrolledToBottom}
                    data-testid="checkbox-agree-arbitration"
                  />
                  <label htmlFor="agreedArbitration" className="text-sm leading-relaxed cursor-pointer">
                    I agree to <strong>binding arbitration</strong> for any disputes and waive my right to a jury trial and class action participation.
                  </label>
                </div>
              </div>

              <div className="pt-2">
                <Button
                  onClick={() => signMutation.mutate()}
                  disabled={!canSign || signMutation.isPending}
                  size="lg"
                  className="w-full bg-[#F97316] hover:bg-[#ea6c10] text-white shadow-lg shadow-orange-500/20 text-base"
                  data-testid="button-sign-contract"
                >
                  {signMutation.isPending ? (
                    <><Loader2 className="h-5 w-5 animate-spin mr-2" /> Executing Agreement...</>
                  ) : (
                    <>
                      <PenLine className="h-5 w-5 mr-2" />
                      Sign Contract as "{signerName || "..."}"
                      <ArrowRight className="h-4 w-4 ml-2" />
                    </>
                  )}
                </Button>
                <p className="text-xs text-center text-muted-foreground mt-3">
                  By clicking "Sign Contract", you are agreeing to a legally binding contract. Your signature, IP address, timestamp, and browser information will be recorded.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="text-center text-xs text-muted-foreground pb-8 space-y-1">
          <p>This document is protected by 256-bit encryption and compliant with E-SIGN Act and UETA.</p>
          <p>Contract ID: #{contract.id} • Generated: {new Date(contract.createdAt).toLocaleString()}</p>
          <p>Questions? Contact support@constructhub.us</p>
        </div>
      </div>
    </div>
  );
}

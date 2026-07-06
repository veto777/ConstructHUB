# Construction Hub

## Overview
Construction Hub is a web application that aggregates nationwide construction permit data to provide a unified interface for searching and managing permit-related information. It aims to streamline data access for construction professionals by offering a directory of permit databases, tools for scheduling data scrapes, managing search history, analyzing Google Business Profile (GBP) data, and running citation campaigns. The project's vision is to become an indispensable resource for the construction industry, enhancing efficiency in data access and management.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Monorepo Structure
The application uses a monorepo structure, separating the React frontend, Express backend, and shared code.

### Frontend
-   **Framework**: React with TypeScript and Vite.
-   **UI/UX**: Features a light mode by default with a dark mode toggle, a dark navy sidebar, and components built with shadcn/ui (New York style) based on Radix UI primitives and Tailwind CSS. Theme-aware CSS variables are used for styling. Google Ads pages incorporate Google brand colors.
-   **Navigation**: Collapsible sidebar organizes tools into "Permits & Databases", "Google Business", and "Google Ads" groups, along with standalone tools and user settings. Feature badges ("HOT", "NEW") highlight specific tools.
-   **Home Page**: A dashboard at `/` displays all 12 tools with descriptions, taglines, and explanations, along with key statistics.
-   **Key Features**:
    -   **Permitting Group**: Includes cross-database search, a filterable database directory, property records, and tools for scrape schedule management and search history. Features a dedicated marketing landing page (`/permits-landing`).
    -   **Google Business Group**: Offers GMB monitoring with AI review response, GMB ranking grids, photo optimization with Media Library (save processed photos to named folders, attach to review requests), locations manager with GBP analytics and citation campaigns, GBP reinstatement service, and an LSA setup guide.
    -   **Google Ads Group**: Provides Google Click Guard for click fraud protection (with fraud analytics, traffic sources, and IP exclusion), Google Ad Fraud exposé, a comprehensive Google Ads Guide, and an AI Ads Consultant Chat Bot (floating widget powered by OpenAI using Master Class content).
    -   **IP Tracker**: A visitor tracking dashboard at `/ip-tracker` with features like online visitors, daily stats, visitor lists with detailed information, traffic sources, landing pages, geographical data, and platform breakdowns.
    -   **VPN Shield**: A standalone VPN/proxy blocker at `/vpn-shield` that generates an embeddable script to detect and block VPN/proxy users while whitelisting search engine crawlers.
    -   **Google Reviews**: A two-tab system at `/google-reviews` for professional feedback-gated review collection (Review Requests with template management) and Google review monitoring (Google Profile Reviews with search, filtering, stats, and reply management). Includes an educational section on feedback funnel strategy.
    -   **Competitor Intelligence**: (Platinum tier) Provides market scans and ad spy functionalities.
    -   **Master Class**: A state-by-state guide for construction business setup and management, covering LLC formation, licensing, bonding, insurance, and business strategies.

### Backend
-   **Framework**: Express 5 on Node.js with TypeScript.
-   **API**: Provides a RESTful JSON API.
-   **Authentication**: Supports Google OAuth and email/password using Passport.js with PostgreSQL session store, email verification, and password reset.
-   **Scraping Engine**: Uses Playwright-core for headless browser automation and Cheerio for HTML parsing, enabling multi-platform scraping with data deduplication.
-   **SEO Contract System**: Manages digital contract signing for SEO services, enabling users to review and digitally sign agreements before proceeding to payment.

### Database
-   **Type**: PostgreSQL.
-   **ORM**: Drizzle ORM with `drizzle-zod` for schema validation.
-   **Schema**: Stores users, permit data, property records, search metadata, scrape schedules, GMB data, business locations, citation campaign data, analytics, state guides, course info, purchase records, beta access codes, and media library (folders and photos).
-   **Trial Access System**: Allows admins to generate and manage trial codes with configurable durations, which users can redeem.

### Legal Pages
-   **Privacy Policy**: Located at `/privacy`, detailing data collection, tracking, and user rights.
-   **Terms of Use**: Located at `/terms`, covering subscription plans, pricing, services, and policies.
-   **Terms Agreement**: Required during email signup.
-   **Support**: `support@constructhub.us` is provided.
-   **Copyright**: "© 2025 Construction Hub" is displayed.

### Hidden Pages & Features (Feature-Flagged)
-   **Control switches**: `client/src/lib/features.ts` exports two flags, both default `false`. Flipping either to `true` re-enables its whole feature surface in one change.
    -   `SHOW_COMPETITOR_INTEL` — the Competitor Intelligence feature.
    -   `SHOW_GOOGLE_REVIEWS` — the Google Reviews feature (review-request gating funnel).
-   **Why Competitor Intel is hidden**: Competitor-monitoring messaging reads as surveillance to a Google Business Profile (GBP) API reviewer and conflicts with the "manage our own profile" use case (the likely cause of the earlier API rejection). The competitor tools only use public Google Maps/Places data, not the GBP API, so they are hidden — not removed — until GBP API access is approved and stable.
-   **Why Google Reviews is hidden**: The review-request flow routes customers by sentiment (high ratings sent to Google, low ratings diverted to a private feedback form). Google's policies prohibit this "review gating" — a reviewer who sees it will reject the GBP API request, and it can put the underlying Business Profile at risk of suspension.
-   **Hidden pages** (return Not Found while the relevant flag is off):
    -   Competitor Intelligence tool (`/competitors`).
    -   Competitor Intelligence marketing landing page (`/competitors-landing`).
    -   Google Reviews tool (`/google-reviews`).
    -   Customer-facing review feedback form (`/review/:token`) and its unsubscribe page (`/review/:token/unsubscribe`).
-   **Hidden features/surfaces**:
    -   "Competitor Intel" item in the sidebar navigation.
    -   "Competitor Intelligence" tool card on the home dashboard (`/`).
    -   "Competitor Intelligence" service card on the public landing page.
    -   "Google Reviews" item in the sidebar navigation.
-   **Re-enabling Google Reviews caution**: Before flipping `SHOW_GOOGLE_REVIEWS` back to `true`, remove the sentiment gating so EVERY customer is offered the Google review option, and delete any "keeps negative reviews off Google" / "trade work for reviews" wording. Re-enabling the funnel as-is will fail a Google audit.
-   **Permanent copy changes (NOT reverted by the flag)**: surveillance-flavored wording was softened to neutral language on the IP Tracker, VPN Shield, and GMB Monitor descriptions. These are honest improvements and should stay even after the flag is re-enabled.
-   **Re-enabling caution**: Google re-audits sensitive-scope apps after approval. When setting the flag back to `true`, keep wording honest ("public market research") rather than "spy on competitors / see everything they're doing," or an audit can revoke access.

### Build Process
-   **Development**: `npm run dev` for server with Vite HMR.
-   **Production**: `npm run build` for client compilation with Vite and server bundling with esbuild.

## External Dependencies

### Database
-   **PostgreSQL**: Primary data storage.

### Object Storage
-   **Cloudflare R2**: Used for storing company logos, GMB logos, and other file uploads.

### Key Libraries/Services
-   **drizzle-orm**, **drizzle-kit**: Database interactions.
-   **express**: Backend web framework.
-   **@tanstack/react-query**: Frontend state management.
-   **wouter**: Client-side router.
-   **zod**: Schema validation.
-   **shadcn/ui**: UI component library.
-   **@aws-sdk/client-s3**: S3-compatible client for Cloudflare R2.
-   **playwright-core**: Headless browser automation.
-   **cheerio**: HTML parsing.
-   **connect-pg-simple**: PostgreSQL session store.
-   **nodemailer**: Email sending (via Gmail SMTP).
-   **Google Places API**: For business lookups and location details.
-   **OpenAI**: For generating SEO descriptions and powering the AI Ads Consultant.
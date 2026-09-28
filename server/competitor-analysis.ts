export function analyzeReviews(reviews: any[], place: any, industry: string): any {
  if (!reviews || reviews.length === 0) {
    return {
      totalAnalyzed: 0,
      goodReviews: 0,
      badReviews: 0,
      neutralReviews: 0,
      reviewsWithPhotos: 0,
      reviewsWithRealNames: 0,
      reviewsLookingAi: 0,
      reviewsGeneric: 0,
      reviewsSpecific: 0,
      blockedProfiles: 0,
      reviewersSharingLocations: 0,
      oldestReviewAge: null,
      reviewVelocityFlag: false,
      reviewVelocityNote: null,
      aiSuspectReviews: [],
      genericReviews: [],
      flaggedReviewers: [],
      reviews: [],
    };
  }

  let goodReviews = 0, badReviews = 0, neutralReviews = 0;
  let reviewsWithPhotos = 0, reviewsWithRealNames = 0;
  let reviewsLookingAi = 0, reviewsGeneric = 0, reviewsSpecific = 0;
  let blockedProfiles = 0;
  const aiSuspectReviews: any[] = [];
  const genericReviews: any[] = [];
  const flaggedReviewers: any[] = [];
  const reviewDetails: any[] = [];
  const authorLocations: Record<string, number> = {};

  const aiPatterns = [
    /highly recommend/i, /exceeded expectations/i, /couldn't be happier/i,
    /top-notch/i, /above and beyond/i, /look no further/i,
    /professional and courteous/i, /from start to finish/i,
    /a pleasure to work with/i, /will definitely be using/i,
    /5 stars? ?(isn't|is not) enough/i, /second to none/i,
    /exceptional service/i, /outstanding work/i, /truly exceptional/i,
  ];

  const specificIndicators = [
    /\b(John|Mike|Dave|Steve|Tom|Chris|Brian|Mark|Jeff|Dan|James|Bob|Jim|Joe|Bill|Rick|Scott|Tim|Larry|Matt|Rob|Paul|Josh|Kevin|Adam|Eric|Ben|Ryan|Nick|Jake|Sam|Gary|Doug|Tony|Greg|Andy|Phil|Craig|Wayne|Bruce|Carl|Ray|Ron|Ken|Frank|Ed|Earl|Roy|Lee|Jack|Kyle|Brad|Sean|Derek|Chad|Kirk|Troy|Seth|Todd|Curt|Norm|Hank|Neil|Wade|Vince|Stan)\b/i,
    /\b(replaced|installed|repaired|fixed|built|painted|cleaned|removed|demolished|renovated)\b.*\b(roof|siding|deck|window|door|bathroom|kitchen|drywall|concrete|gutter|fence|floor|tile|cabinet|pipe|drain|AC|furnace|heater)\b/i,
    /\$\d+/,
    /\d+ (days?|weeks?|months?|hours?)/,
    /\b(sq\s?ft|square feet|linear feet)\b/i,
  ];

  const genericPhrases = [
    "great job", "great work", "great service", "great company", "highly recommend",
    "very professional", "excellent work", "excellent service", "amazing work",
    "wonderful experience", "fantastic job", "top notch", "best company",
    "would definitely recommend", "thank you so much",
  ];

  for (const review of reviews) {
    const text = review.text || "";
    const rating = review.rating || 0;
    const authorName = review.author_name || "";
    const profileUrl = review.author_url || "";
    const relativeTime = review.relative_time_description || "";

    if (rating >= 4) goodReviews++;
    else if (rating <= 2) badReviews++;
    else neutralReviews++;

    const hasPhoto = !!(review.profile_photo_url && !review.profile_photo_url.includes("default"));
    if (hasPhoto) reviewsWithPhotos++;

    const looksRealName = /^[A-Z][a-z]+ [A-Z]/.test(authorName) && !authorName.includes("Google") && authorName.length > 3;
    if (looksRealName) reviewsWithRealNames++;

    const isBlocked = !profileUrl || profileUrl.includes("/reviews") === false;

    let aiScore = 0;
    aiPatterns.forEach(pattern => { if (pattern.test(text)) aiScore++; });
    if (text.length > 200 && text.length < 500 && aiScore >= 2) aiScore++;
    if (text.split(".").length >= 4 && text.split(".").every((s: string) => s.trim().length > 20)) aiScore++;
    const looksAi = aiScore >= 3;
    if (looksAi) {
      reviewsLookingAi++;
      aiSuspectReviews.push({ author: authorName, text: text.substring(0, 150) + "...", rating, aiScore });
    }

    let isGeneric = false;
    const textLower = text.toLowerCase();
    const genericCount = genericPhrases.filter(p => textLower.includes(p)).length;
    const specificCount = specificIndicators.filter(p => p.test(text)).length;
    if (specificCount > 0) {
      reviewsSpecific++;
    } else if (genericCount >= 2 || (text.length < 80 && genericCount >= 1)) {
      isGeneric = true;
      reviewsGeneric++;
      genericReviews.push({ author: authorName, text: text.substring(0, 120) + "...", rating });
    } else if (text.length > 0) {
      reviewsSpecific++;
    }

    if (isBlocked) {
      blockedProfiles++;
      flaggedReviewers.push({ author: authorName, reason: "Profile link unavailable in this sample", profileUrl });
    }

    const locationMatch = authorName.match(/Local Guide/i);
    if (review.author_url) {
      const urlKey = review.author_url.replace(/\/reviews$/, "");
      authorLocations[urlKey] = (authorLocations[urlKey] || 0) + 1;
    }

    reviewDetails.push({
      author: authorName,
      rating,
      text: text.substring(0, 200),
      relativeTime,
      hasPhoto,
      looksRealName,
      looksAi,
      isGeneric,
      isBlocked,
      isLocalGuide: !!locationMatch,
    });
  }

  const duplicateLocations = Object.values(authorLocations).filter(c => c > 1).length;

  let oldestReviewAge: string | null = null;
  const timeDescriptions = reviews.map(r => r.relative_time_description || "").filter(Boolean);
  const yearMatches = timeDescriptions.filter(t => /year/i.test(t));
  const monthMatches = timeDescriptions.filter(t => /month/i.test(t));
  if (yearMatches.length > 0) {
    const years = yearMatches.map(t => { const m = t.match(/(\d+)/); return m ? parseInt(m[1]) : 1; });
    oldestReviewAge = `${Math.max(...years)} year(s)`;
  } else if (monthMatches.length > 0) {
    const months = monthMatches.map(t => { const m = t.match(/(\d+)/); return m ? parseInt(m[1]) : 1; });
    oldestReviewAge = `${Math.max(...months)} month(s)`;
  } else if (timeDescriptions.length > 0) {
    oldestReviewAge = "Less than a month";
  }

  // Places returns a selected sample, not a complete timeline. Neither the
  // sample's oldest date nor lifetime count can establish review velocity.
  const reviewVelocityFlag = false;
  const reviewVelocityNote = "Review velocity is unavailable: the provider supplies a selected sample, not a complete review timeline.";

  return {
    totalAnalyzed: reviews.length,
    goodReviews,
    badReviews,
    neutralReviews,
    reviewsWithPhotos,
    reviewsWithRealNames,
    reviewsLookingAi,
    reviewsGeneric,
    reviewsSpecific,
    blockedProfiles,
    reviewersSharingLocations: duplicateLocations,
    oldestReviewAge,
    reviewVelocityFlag,
    reviewVelocityNote,
    aiSuspectReviews: aiSuspectReviews.slice(0, 5),
    genericReviews: genericReviews.slice(0, 5),
    flaggedReviewers: flaggedReviewers.slice(0, 5),
    reviews: reviewDetails,
  };
}

export function analyzeBsScore(place: any, reviewAnalysis?: any): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  const name = (place.name || "").toLowerCase();
  const keywordStuffWords = ["best", "top", "cheap", "#1", "number one", "near me", "affordable", "guaranteed"];
  const stuffedCount = keywordStuffWords.filter(kw => name.includes(kw)).length;
  if (stuffedCount >= 2) {
    score += 25;
    reasons.push("Business name appears keyword-stuffed");
  } else if (stuffedCount === 1) {
    score += 8;
    reasons.push("Business name contains a ranking keyword");
  }

  const rating = place.rating || 0;
  const reviewCount = place.user_ratings_total || 0;
  if (rating === 5.0 && reviewCount > 20) {
    score += 20;
    reasons.push("Perfect rating; consider the sample size and business context");
  } else if (rating >= 4.9 && reviewCount > 50) {
    score += 12;
    reasons.push("High average rating with many reviews");
  }
  if (reviewCount > 200 && rating >= 4.8) {
    score += 10;
    reasons.push("Very high review count with near-perfect rating");
  }

  if (!place.formatted_address || place.formatted_address.includes("PO Box")) {
    score += 12;
    reasons.push("Street address is unavailable or lists a PO Box; service-area businesses may omit an address");
  }

  if (name.length > 60) {
    score += 10;
    reasons.push("Long business name; verify the registered name if relevant");
  }

  if (reviewAnalysis && reviewAnalysis.totalAnalyzed > 0) {
    const total = reviewAnalysis.totalAnalyzed;
    const aiPct = (reviewAnalysis.reviewsLookingAi / total) * 100;
    const genericPct = (reviewAnalysis.reviewsGeneric / total) * 100;
    const blockedPct = (reviewAnalysis.blockedProfiles / total) * 100;
    const photoPct = (reviewAnalysis.reviewsWithPhotos / total) * 100;

    if (aiPct > 50) {
      score += 20;
      reasons.push(`${reviewAnalysis.reviewsLookingAi}/${total} sampled reviews contain repeated common phrases (${Math.round(aiPct)}%)`);
    } else if (aiPct > 25) {
      score += 10;
      reasons.push(`${reviewAnalysis.reviewsLookingAi}/${total} sampled reviews contain repeated common phrases (${Math.round(aiPct)}%)`);
    }

    if (genericPct > 60) {
      score += 12;
      reasons.push(`${Math.round(genericPct)}% of reviews are generic with no specific details`);
    } else if (genericPct > 40) {
      score += 6;
      reasons.push(`${Math.round(genericPct)}% of reviews are generic`);
    }

    if (reviewAnalysis.reviewVelocityFlag) {
      score += 15;
      reasons.push(reviewAnalysis.reviewVelocityNote || "Review timeline unavailable");
    }

    if (reviewAnalysis.badReviews === 0 && total > 10) {
      score += 8;
      reasons.push("No negative reviews in this selected sample");
    }
  }

  score = Math.min(score, 100);

  if (score === 0) {
    reasons.push("No selected signals found; this does not establish review authenticity");
  }

  return { score, reasons };
}


export function presentListing(listing: any) {
  const analysis = listing.reviewAnalysis ? { ...listing.reviewAnalysis,
    reviewVelocityFlag: false,
    reviewVelocityNote: "Review velocity is unavailable from a selected sample.",
    flaggedReviewers: [],
  } : null;
  const score = analyzeBsScore({ name: listing.businessName, rating: Number(listing.rating),
    user_ratings_total: listing.reviewCount, formatted_address: listing.address }, analysis);
  return { ...listing, reviewAnalysis: analysis, bsScore: score.score, bsReasons: score.reasons };
}

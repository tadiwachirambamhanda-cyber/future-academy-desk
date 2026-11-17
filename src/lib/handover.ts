// F6: the fixed holding replies. Approved once by a person, then sent by code.
// The English wording is final. The Shona and Ndebele wording is a DRAFT: native speakers should review it.
import { getHandbookText } from "./handbook";
import type { HandoverReason, ReplyLanguage } from "./rules";

export function officePhone(handbook: string = getHandbookText()): string {
  return handbook.match(/Admissions office:\s*(\+[\d ]+\d)/)?.[1] ?? "the school office";
}

type Texts = { standard: string; urgent: string };

const TEXTS: Record<ReplyLanguage, Texts> = {
  english: {
    standard:
      "Thank you for your message. I'm passing it to our admissions office, who will get back to you. You can also call or WhatsApp them on {phone}, Monday to Friday, 08:00 to 16:00.",
    urgent:
      "Thank you for telling us. Because this is about a child's health or safety, please call the school office now on {phone}. I'm also passing your message to our admissions office straight away.",
  },
  shona: {
    standard:
      "Tatenda nemashoko enyu. Ndiri kuendesa mubvunzo wenyu kuhofisi yedu yeadmissions, vachakubatai. Munogona zvakare kufonera kana kunyorera pa{phone}, Muvhuro kusvika China, 08:00 kusvika 16:00.",
    urgent:
      "Tatenda nekutiudza. Sezvo izvi zvichibatana neutano kana kuchengetedzeka kwemwana, ndapota fonai kuhofisi yechikoro ikozvino pa{phone}. Ndiri kuendeswawo mashoko enyu kuhofisi yeadmissions nekukurumidza.",
  },
  ndebele: {
    standard:
      "Siyabonga ngomlayezo wakho. Ngiwuthumela ehhovisi lethu le-admissions, abazakuphendula. Ungabuye ubize noma ubhalele ku-{phone}, ngoMsombuluko kuze kube yiLwesihlanu, 08:00 kuya ku-16:00.",
    urgent:
      "Siyabonga ngokusitshela. Njengoba lokhu kumayelana nempilo noma ukuphepha komntwana, sicela ubize ihhovisi lesikole khathesi ku-{phone}. Ngiwuthumela futhi umlayezo wakho ehhovisi le-admissions ngokuphangisa.",
  },
};

export function holdingReply(reason: HandoverReason, language: ReplyLanguage, phone: string = officePhone()): string {
  const urgent = reason === "health_safety";
  // An unsupported language gets the English wording.
  const texts = reason === "unsupported_language" ? TEXTS.english : TEXTS[language];
  return (urgent ? texts.urgent : texts.standard).replace("{phone}", phone);
}

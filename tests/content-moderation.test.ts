/**
 * The profanity filter every chat uses: typed messages with a blocked word are
 * refused (containsProfanity), and messages the site can't refuse — Discord
 * chat mirrored into a match room, older messages — are shown masked
 * (maskProfanity).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { containsProfanity, maskProfanity } from "@/lib/content-moderation";

describe("containsProfanity", () => {
  it("blocks the words and their other forms", () => {
    for (const text of [
      "fuck", "FUCK you", "this is fucked", "fuckin hell", "bitches", "bullshit",
      "motherfucker", "niggers", "niggas", "faggots", "retards", "whores", "cunts",
      "dickhead", "you piss me off", "pissed",
    ]) {
      assert.equal(containsProfanity(text), true, text);
    }
  });

  it("sees through disguises", () => {
    for (const text of [
      "a$$hole", "@sshole", "$h1t", "b!tch", "s1ut", "5h!t", "fuuuuck", "shiiiit",
      "f u c k", "f.u.c.k", "s-h-i-t", "S H I T",
      "ｆｕｃｋ", // full-width
      "fück", // ü
      "fu​ck", // zero-width space
      "fuсk", // Cyrillic с
    ]) {
      assert.equal(containsProfanity(text), true, JSON.stringify(text));
    }
  });

  it("leaves ordinary words alone", () => {
    for (const text of [
      "class", "assassin", "cocktail", "peacock", "Scunthorpe", "analysis", "canal",
      "spicy", "cumin", "document", "therapist", "grapes", "skyscraper", "Niger",
      "title", "titan", "Dickens", "cocky", "Essex", "Middlesex", "sextant",
      "shiitake", "homework", "passed", "gg 13-7 ez", "1v1 me", "5v5 at 8", "k/d 1.5",
    ]) {
      assert.equal(containsProfanity(text), false, text);
    }
  });

  it("gives the same answer every time", () => {
    assert.equal(containsProfanity("shit"), true);
    assert.equal(containsProfanity("shit"), true);
    assert.equal(containsProfanity("fine"), false);
  });
});

describe("maskProfanity", () => {
  it("replaces each blocked word with #s and keeps the rest", () => {
    assert.equal(maskProfanity("gg fucking ez"), "gg ####### ez");
    assert.equal(maskProfanity("you're a $h1t player"), "you're a #### player");
    assert.equal(maskProfanity("s1ut"), "####");
    assert.equal(maskProfanity("fuuuuck off"), "####### off");
    assert.equal(maskProfanity("f u c k this"), "####### this");
    assert.equal(maskProfanity("nice 😀 shit"), "nice 😀 ####");
    assert.equal(maskProfanity("fu​ck"), "#####");
  });

  it("returns clean text unchanged", () => {
    for (const text of ["class act, nice cocktail", "gg wp 13-11", "", "😀👍"]) {
      assert.equal(maskProfanity(text), text);
    }
  });
});

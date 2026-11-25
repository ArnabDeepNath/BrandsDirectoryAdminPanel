import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_NOTIFICATION_RECIPIENTS,
  getDefaultNotificationRecipient,
} from "../brand-notification-emails.js";

const EXPECTED_RECIPIENTS = {
  "Rokael Beauty": "celeste@rokaelbeauty.com",
  "Libertad Vida": "polett@libertadvida.com",
  "Gente Beauty": "nicolle@gentebeauty.com",
  "Dezi Skin": "steven@dezi.co",
  "Lasio Professional Hair Care": "education@lasioinc.com",
  "Ki'olal Biocosmetics": "jt@kiolal.com",
  Dominique: "cesar@dominique.com",
  OCOA: "jerry@ocoabeauty.com",
  Sarelly: "valeria@sarelly.com",
  "The Hair Generation": "thg@thehairg.com",
  "ORTEGA Beauty": "monica@etienneortega.com",
  "mi|tu corazón": "andrea@mitucorazon.com",
  "Just Blessed Hair": "hello@justblessed.com",
  "STACE Beauty": "hellostacebeauty@gmail.com",
  "Vita Parfum": "vitaparfuminfo@gmail.com",
  "PDL Cosmetics": "patricia@pdlcosmetics.com",
  "Soy Latina": "info@soylatinacandles.com",
  "Prados Beauty": "pradosbeauty@gmail.com",
  "LENDAVA SKINCARE": "priscila@lendavaskin.com",
  "ALOISIA BEAUTY": "veronica@aloisiabeauty.com",
  "Youth Dealer™": "brandi@youthdealer.co",
  "EAUSO VERT": "tanya@eauso.com",
  "SBS Cosmetics": "info@sbscosmetics.com",
  "Seis Cosmetics": "hello@seiscosmetics.com",
  "Melt Cosmetics": "lora@meltcosmetics.com",
  "AORA MEXICO": "nour@aoramakeup.com",
};

test("all requested brand notification emails are mapped once and normalized", () => {
  assert.equal(DEFAULT_NOTIFICATION_RECIPIENTS.length, 26);
  assert.equal(
    new Set(DEFAULT_NOTIFICATION_RECIPIENTS.map(({ email }) => email)).size,
    DEFAULT_NOTIFICATION_RECIPIENTS.length,
  );

  for (const { vendorName, email } of DEFAULT_NOTIFICATION_RECIPIENTS) {
    assert.equal(EXPECTED_RECIPIENTS[vendorName], email);
    assert.equal(email, email.trim().toLowerCase());
  }
  assert.deepEqual(
    Object.fromEntries(DEFAULT_NOTIFICATION_RECIPIENTS.map(({ vendorName, email }) => [vendorName, email])),
    EXPECTED_RECIPIENTS,
  );
});

test("default recipient lookup ignores vendor-name casing and surrounding whitespace", () => {
  assert.deepEqual(getDefaultNotificationRecipient("  aora mexico "), {
    vendorName: "AORA MEXICO",
    email: "nour@aoramakeup.com",
  });
  assert.equal(getDefaultNotificationRecipient("Unknown Brand"), undefined);
});

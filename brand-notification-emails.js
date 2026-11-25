// Default order-notification recipients. Shopify notification settings, when
// present, override these values so brands can change their recipient or opt out.
export const DEFAULT_NOTIFICATION_RECIPIENTS = Object.freeze([
  { vendorName: "Rokael Beauty", email: "celeste@rokaelbeauty.com" },
  { vendorName: "Libertad Vida", email: "polett@libertadvida.com" },
  { vendorName: "Gente Beauty", email: "nicolle@gentebeauty.com" },
  { vendorName: "Dezi Skin", email: "steven@dezi.co" },
  { vendorName: "Lasio Professional Hair Care", email: "education@lasioinc.com" },
  { vendorName: "Ki'olal Biocosmetics", email: "jt@kiolal.com" },
  { vendorName: "Dominique", email: "cesar@dominique.com" },
  { vendorName: "OCOA", email: "jerry@ocoabeauty.com" },
  { vendorName: "Sarelly", email: "valeria@sarelly.com" },
  { vendorName: "The Hair Generation", email: "thg@thehairg.com" },
  { vendorName: "ORTEGA Beauty", email: "monica@etienneortega.com" },
  { vendorName: "mi|tu corazón", email: "andrea@mitucorazon.com" },
  { vendorName: "Just Blessed Hair", email: "hello@justblessed.com" },
  { vendorName: "STACE Beauty", email: "hellostacebeauty@gmail.com" },
  { vendorName: "Vita Parfum", email: "vitaparfuminfo@gmail.com" },
  { vendorName: "PDL Cosmetics", email: "patricia@pdlcosmetics.com" },
  { vendorName: "Soy Latina", email: "info@soylatinacandles.com" },
  { vendorName: "Prados Beauty", email: "pradosbeauty@gmail.com" },
  { vendorName: "LENDAVA SKINCARE", email: "priscila@lendavaskin.com" },
  { vendorName: "ALOISIA BEAUTY", email: "veronica@aloisiabeauty.com" },
  { vendorName: "Youth Dealer™", email: "brandi@youthdealer.co" },
  { vendorName: "EAUSO VERT", email: "tanya@eauso.com" },
  { vendorName: "SBS Cosmetics", email: "info@sbscosmetics.com" },
  { vendorName: "Seis Cosmetics", email: "hello@seiscosmetics.com" },
  { vendorName: "Melt Cosmetics", email: "lora@meltcosmetics.com" },
  { vendorName: "AORA MEXICO", email: "nour@aoramakeup.com" },
]);

export function getDefaultNotificationRecipient(vendorName) {
  const normalizedVendor = String(vendorName || "").trim().toLowerCase();
  return DEFAULT_NOTIFICATION_RECIPIENTS.find(
    ({ vendorName: defaultVendor }) =>
      defaultVendor.trim().toLowerCase() === normalizedVendor,
  );
}

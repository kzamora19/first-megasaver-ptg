export const securitySections = [
  ["master", "System Availability"],
  ["branches", "Branch Control"],
  ["admins", "System Admin"],
  ["permissions", "Permissions"],
  ["srp", "Product SRP Import"],
  ["audit", "Audit Log"],
] as const;

export type SecuritySection = (typeof securitySections)[number][0];

export function getSecuritySection(value: string | null): SecuritySection {
  return securitySections.find(([key]) => key === value)?.[0] ?? "master";
}

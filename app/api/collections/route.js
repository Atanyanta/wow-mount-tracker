import { NextResponse } from "next/server";
import { getClientCredentialsToken, blizzardFetch } from "@/lib/blizzard";
import { findRealm, getRealms } from "@/lib/realms";

const REGIONS = new Set(["us", "eu", "kr", "tw"]);
const REGION_LOCALES = { us: "en_US", eu: "en_GB", kr: "ko_KR", tw: "zh_TW" };

function toSlug(input) {
  return input.trim().toLowerCase().replace(/'/g, "").replace(/\s+/g, "-");
}

// Realm and character slugs are interpolated straight into a Blizzard API URL
// path, so anything beyond letters (any script - KR/TW realms aren't Latin),
// digits and hyphens is rejected up front: "?", "/", "#" or "../" could
// otherwise change which upstream URL gets requested.
const SLUG_PATTERN = /^[\p{L}\p{M}\p{N}-]{1,64}$/u;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const region = (searchParams.get("region") || "us").toLowerCase();
  const realm = searchParams.get("realm");
  const name = searchParams.get("name");

  if (!realm || !name) {
    return NextResponse.json({ error: "realm and name are required" }, { status: 400 });
  }
  if (!REGIONS.has(region)) {
    return NextResponse.json({ error: "unsupported region" }, { status: 400 });
  }

  // The realm must be a real one for this region (data/realms.json, built from
  // Blizzard's realm index). It may be given as a slug or as a name; either way
  // we use Blizzard's own slug, which isn't derivable from the name ("Azjol-Nerub"
  // is "azjolnerub"). A region with no list yet falls back to the old behaviour
  // rather than blocking every lookup.
  const realmMatch = findRealm(region, realm);
  if (!realmMatch && getRealms(region).length > 0) {
    return NextResponse.json({ error: "Unknown realm for this region - pick one from the realm list" }, { status: 400 });
  }
  const realmSlug = realmMatch ? realmMatch.slug : toSlug(realm);
  const characterSlug = toSlug(name);
  if (!SLUG_PATTERN.test(realmSlug) || !SLUG_PATTERN.test(characterSlug)) {
    return NextResponse.json(
      { error: "Realm and character name may only contain letters, numbers, spaces, apostrophes and hyphens" },
      { status: 400 }
    );
  }
  const locale = REGION_LOCALES[region];

  try {
    const token = await getClientCredentialsToken();
    const res = await blizzardFetch(
      `/profile/wow/character/${realmSlug}/${characterSlug}/collections/mounts?namespace=profile-${region}&locale=${locale}`,
      token,
      { region }
    );

    if (res.status === 404) {
      return NextResponse.json(
        { error: "Character not found (check the name, realm, and region)" },
        { status: 404 }
      );
    }
    if (res.status === 429) {
      return NextResponse.json(
        { error: "Blizzard API rate limit hit, try again shortly" },
        { status: 429 }
      );
    }
    if (!res.ok) {
      return NextResponse.json({ error: `Blizzard API error (${res.status})` }, { status: 502 });
    }

    const data = await res.json();
    const ownedIds = (data.mounts || []).map((m) => m.mount.id);
    // Each entry also carries `is_useable` (whether *this character* can use
    // the mount - class/faction/riding restrictions) in the same response, so
    // the usable count costs no extra Blizzard call.
    const usableIds = (data.mounts || []).filter((m) => m.is_useable).map((m) => m.mount.id);

    // Used to hide the opposing faction's mounts in the grid. Best-effort -
    // if this call fails for any reason, fall back to showing everything
    // rather than failing the whole lookup over a non-essential field.
    let faction = null;
    try {
      const profileRes = await blizzardFetch(
        `/profile/wow/character/${realmSlug}/${characterSlug}?namespace=profile-${region}&locale=${locale}`,
        token,
        { region }
      );
      if (profileRes.ok) {
        const profile = await profileRes.json();
        faction = profile.faction?.type?.toLowerCase() || null;
      }
    } catch {
      // ignore, faction stays null
    }

    return NextResponse.json({ ownedIds, usableIds, faction });
  } catch {
    return NextResponse.json({ error: "Lookup failed, try again" }, { status: 500 });
  }
}

import { describe, expect, it } from "vitest";
import {
  classifyGuess,
  isArtistMatch,
  normalizeArtist,
  normalizeTitle,
  splitArtists,
} from "@/lib/feedback";
import type { Track } from "@/types/catalog";

const baseTargetTrack: Track = {
  id: "bad-bunny-safaera",
  title: "Safaera",
  artist: "Bad Bunny",
  genreId: "latin.urbano.reggaeton",
  provider: "deezer",
  providerTrackId: "908604612",
};

describe("normalizeArtist", () => {
  it("normalizes case, extra whitespace, and diacritics including Beyonce", () => {
    expect(normalizeArtist("Beyoncé")).toBe("beyonce");
    expect(normalizeArtist("  BEYONCÉ  ")).toBe("beyonce");
    expect(normalizeArtist("Rosalía")).toBe("rosalia");
    expect(normalizeArtist("Sigur Rós")).toBe("sigur ros");
    expect(normalizeArtist("MØ")).toBe("mo");
  });

  it("normalizes ampersands to 'and'", () => {
    expect(normalizeArtist("Simon & Garfunkel")).toBe("simon and garfunkel");
    expect(normalizeArtist("Simon and Garfunkel")).toBe("simon and garfunkel");
    expect(normalizeArtist("Florence + The Machine")).toBe("florence and the machine");
  });

  it("strips feat., ft., featuring, and with credits", () => {
    expect(normalizeArtist("Bad Bunny feat. Chencho Corleone")).toBe("bad bunny");
    expect(normalizeArtist("Bad Bunny ft. Jhay Cortez")).toBe("bad bunny");
    expect(normalizeArtist("Bad Bunny (feat. Bomba Estéreo)")).toBe("bad bunny");
    expect(normalizeArtist("Calvin Harris [featuring Rihanna]")).toBe("calvin harris");
    expect(normalizeArtist("Lady Gaga with Bruno Mars")).toBe("lady gaga");
    expect(normalizeArtist("Lady Gaga (with Bruno Mars)")).toBe("lady gaga");
  });

  it("handles commas and punctuation in artist names like Tyler, The Creator", () => {
    expect(normalizeArtist("Tyler, The Creator")).toBe("tyler the creator");
    expect(normalizeArtist("Tyler The Creator")).toBe("tyler the creator");
    expect(normalizeArtist("Jay-Z")).toBe("jay z");
  });

  it("preserves 'with' inside song titles while still stripping bracketed with credits", () => {
    expect(normalizeTitle("Stay With Me")).toBe("stay with me");
    expect(normalizeTitle("Boy With Luv (feat. Halsey)")).toBe("boy with luv");
    expect(normalizeTitle("Die With A Smile (with Bruno Mars)")).toBe("die with a smile");
  });
});

describe("splitArtists and isArtistMatch", () => {
  it("preserves trailing or hyphenated X in single artist names like Lil Nas X and Static-X", () => {
    expect(splitArtists("Lil Nas X")).toEqual(["lil nas x"]);
    expect(splitArtists("Static-X")).toEqual(["static x"]);
    expect(splitArtists("Generation X")).toEqual(["generation x"]);
    expect(isArtistMatch("Static-X", "Static Major")).toBe(false);
    expect(isArtistMatch("Generation X", "Generation")).toBe(false);
  });

  it("keeps Tyler, The Creator intact without splitting on the internal comma", () => {
    expect(splitArtists("Tyler, The Creator")).toEqual(["tyler the creator"]);
    expect(isArtistMatch("Tyler, The Creator", "Tyler The Creator")).toBe(true);
    expect(isArtistMatch("Tyler, The Creator", "The Creator")).toBe(false);
    expect(isArtistMatch("Tyler, The Creator", "Tyler")).toBe(false);
  });

  it("splits collaborations that include Tyler, The Creator alongside other artists", () => {
    expect(splitArtists("Tyler, The Creator, Kali Uchis")).toEqual([
      "tyler the creator",
      "kali uchis",
    ]);
    expect(isArtistMatch("Tyler, The Creator, Kali Uchis", "Tyler, The Creator")).toBe(true);
    expect(isArtistMatch("Tyler, The Creator, Kali Uchis", "Kali Uchis")).toBe(true);
    expect(isArtistMatch("Tyler, The Creator & Pharrell Williams", "Pharrell Williams")).toBe(
      true,
    );
  });

  it("matches overlapping credited artists across multi-artist delimiters", () => {
    expect(isArtistMatch("Bad Bunny & Jhay Cortez", "Bad Bunny")).toBe(true);
    expect(isArtistMatch("Bad Bunny & Jhay Cortez", "Jhay Cortez")).toBe(true);
    expect(isArtistMatch("SZA, Travis Scott", "Travis Scott")).toBe(true);
    expect(isArtistMatch("Kanye West / Jay-Z", "Jay Z")).toBe(true);
    expect(isArtistMatch("Skrillex x Fred again..", "Fred again")).toBe(true);
  });

  it("matches whole duo names regardless of '&' or 'and'", () => {
    expect(isArtistMatch("Simon & Garfunkel", "Simon and Garfunkel")).toBe(true);
    expect(isArtistMatch("OutKast", "Big Boi")).toBe(false);
    expect(isArtistMatch("", "Bad Bunny")).toBe(false);
  });
});

describe("classifyGuess", () => {
  it("returns 'correct' for an exact track ID match", () => {
    const guess: Track = { ...baseTargetTrack };
    expect(classifyGuess(guess, baseTargetTrack)).toBe("correct");
  });

  it("returns 'correct' when normalized title and artist match even with a different ID", () => {
    const guess: Track = {
      ...baseTargetTrack,
      id: "alternate-slug",
      title: "  safaera (feat. Jowell & Randy) ",
      artist: "Bad Bunny feat. Jowell & Randy",
    };
    expect(classifyGuess(guess, baseTargetTrack)).toBe("correct");
  });

  it("returns 'artist' when the artist matches or overlaps but the song is wrong", () => {
    const sameArtistWrongSong: Track = {
      id: "bad-bunny-titi-me-pregunto",
      title: "Tití Me Preguntó",
      artist: "Bad Bunny (feat. Bomba Estéreo)",
      genreId: "latin.urbano.reggaeton",
      provider: "deezer",
      providerTrackId: "111111",
    };
    expect(classifyGuess(sameArtistWrongSong, baseTargetTrack)).toBe("artist");

    const collabArtistWrongSong: Track = {
      id: "bad-bunny-dakiti",
      title: "Dákiti",
      artist: "Bad Bunny & Jhay Cortez",
      genreId: "latin.urbano.reggaeton",
      provider: "deezer",
      providerTrackId: "222222",
    };
    expect(classifyGuess(collabArtistWrongSong, baseTargetTrack)).toBe("artist");
  });

  it("returns 'wrong' when neither artist nor song matches", () => {
    const wrongTrack: Track = {
      id: "daddy-yankee-gasolina",
      title: "Gasolina",
      artist: "Daddy Yankee",
      genreId: "latin.urbano.reggaeton",
      provider: "deezer",
      providerTrackId: "333333",
    };
    expect(classifyGuess(wrongTrack, baseTargetTrack)).toBe("wrong");
  });

  it("returns 'artist' when one song is 'Stay' and the answer is 'Stay With Me' by the same artist", () => {
    const target: Track = {
      id: "sam-smith-stay-with-me",
      title: "Stay With Me",
      artist: "Sam Smith",
      genreId: "hip-hop.neo-soul",
      provider: "deezer",
      providerTrackId: "444444",
    };
    const guess: Track = {
      id: "sam-smith-stay",
      title: "Stay",
      artist: "Sam Smith",
      genreId: "hip-hop.neo-soul",
      provider: "deezer",
      providerTrackId: "555555",
    };
    expect(classifyGuess(guess, target)).toBe("artist");
  });

  it("returns 'skipped' when the guess is 'skip', 'skipped', null, or undefined", () => {
    expect(classifyGuess("skip", baseTargetTrack)).toBe("skipped");
    expect(classifyGuess("skipped", baseTargetTrack)).toBe("skipped");
    expect(classifyGuess(null, baseTargetTrack)).toBe("skipped");
    expect(classifyGuess(undefined, baseTargetTrack)).toBe("skipped");
  });
});

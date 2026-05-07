export interface PlanetProfile {
  summary: string;
  atmosphere: string;
  surface: string;
  exploration: string;
  aiPrompts: string[];
}

export const PLANET_PROFILES: Record<string, PlanetProfile> = {
  '10': {
    summary: 'The Sun is the system anchor: a G-type main-sequence star that supplies nearly all of the light, heat, and gravity shaping the planets.',
    atmosphere: 'Its visible surface is the photosphere, above deeper plasma layers and an active magnetic atmosphere.',
    surface: 'The Sun has no solid surface; it is a sphere of plasma with convection, magnetic fields, flares, and prominences.',
    exploration: 'Solar observatories such as SOHO, SDO, Parker Solar Probe, and Solar Orbiter study its atmosphere and solar wind.',
    aiPrompts: [
      'Why does the Sun have an 11-year activity cycle?',
      'How does solar wind affect Earth?',
      'What would change if the Sun were more massive?',
    ],
  },
  '199': {
    summary: 'Mercury is a small rocky world with extreme temperature swings and a heavily cratered surface.',
    atmosphere: 'It has only a very thin exosphere, so heat is not redistributed efficiently around the planet.',
    surface: 'Its surface is rocky, cratered, and marked by cliffs created as the planet cooled and contracted.',
    exploration: 'Mariner 10 and MESSENGER mapped Mercury; BepiColombo is designed to study it in greater detail.',
    aiPrompts: [
      'Why does Mercury have such extreme temperatures?',
      'How can Mercury have ice near the Sun?',
      'What did MESSENGER discover about Mercury?',
    ],
  },
  '299': {
    summary: 'Venus is Earth-sized but radically different: a slow-rotating rocky planet with intense greenhouse heating.',
    atmosphere: 'Its dense carbon dioxide atmosphere and sulfuric acid clouds trap heat very effectively.',
    surface: 'The surface is volcanic, pressure-cooked, and hotter than Mercury despite being farther from the Sun.',
    exploration: 'Venera landers, Magellan radar mapping, and planned missions continue to make Venus a key climate laboratory.',
    aiPrompts: [
      'Why is Venus hotter than Mercury?',
      'Could Venus ever have had oceans?',
      'What makes Venus rotate backwards?',
    ],
  },
  '399': {
    summary: 'Earth is the reference world for this explorer: a rocky planet with liquid water, active geology, and a protective atmosphere.',
    atmosphere: 'A nitrogen-oxygen atmosphere moderates climate and shields the surface from many small impacts and radiation hazards.',
    surface: 'Ocean basins, continents, ice sheets, and plate tectonics make Earth geologically active.',
    exploration: 'Earth observation satellites provide the baseline for climate, weather, and planetary comparison.',
    aiPrompts: [
      'What makes Earth habitable compared with Venus and Mars?',
      'How does Earth compare to the other rocky planets?',
      'Why does Earth have seasons?',
    ],
  },
  '499': {
    summary: 'Mars is a cold rocky planet with ancient river valleys, polar caps, dust storms, and the best-studied surface beyond Earth.',
    atmosphere: 'Its thin carbon dioxide atmosphere allows large daily temperature swings and global dust events.',
    surface: 'Mars has volcanoes, canyons, impact basins, dunes, and mineral evidence for ancient liquid water.',
    exploration: 'Orbiters, landers, and rovers have made Mars the most explored planet besides Earth.',
    aiPrompts: [
      'What evidence shows Mars once had liquid water?',
      'Why did Mars lose much of its atmosphere?',
      'How long would a trip to Mars take?',
    ],
  },
  '599': {
    summary: 'Jupiter is the largest planet, a gas giant whose gravity shapes asteroid populations, moons, and outer solar system dynamics.',
    atmosphere: 'Its visible bands are ammonia clouds and powerful jet streams over deep hydrogen and helium layers.',
    surface: 'Jupiter has no solid surface; pressure and temperature rise continuously below the cloud tops.',
    exploration: 'Pioneer, Voyager, Galileo, Juno, and other spacecraft have studied Jupiter and its complex moon system.',
    aiPrompts: [
      'Why does Jupiter have colored bands?',
      'What powers the Great Red Spot?',
      'How does Jupiter protect or disturb the inner solar system?',
    ],
  },
  '699': {
    summary: 'Saturn is a low-density gas giant famous for its ring system and a diverse family of icy moons.',
    atmosphere: 'Its hydrogen-helium atmosphere contains fast winds, cloud bands, and long-lived storm systems.',
    surface: 'Like Jupiter, Saturn has no solid surface; the visible planet is a deep atmosphere above compressed gas layers.',
    exploration: 'Pioneer 11, Voyager, and Cassini revealed Saturns rings, moons, magnetosphere, and seasonal changes.',
    aiPrompts: [
      'Why are Saturns rings so bright?',
      'Could Saturn float in water?',
      'What makes Titan and Enceladus scientifically important?',
    ],
  },
  '799': {
    summary: 'Uranus is an ice giant tipped almost sideways, making its seasons among the strangest in the solar system.',
    atmosphere: 'Methane in the upper atmosphere absorbs red light and gives Uranus its blue-green color.',
    surface: 'There is no solid surface; icy materials, hydrogen, helium, and methane exist under increasing pressure.',
    exploration: 'Voyager 2 provided the only close flyby, so Uranus remains one of the least explored major planets.',
    aiPrompts: [
      'Why does Uranus rotate on its side?',
      'What is an ice giant?',
      'Why has only one spacecraft visited Uranus?',
    ],
  },
  '899': {
    summary: 'Neptune is a distant ice giant with supersonic winds, methane-tinted clouds, and the captured moon Triton.',
    atmosphere: 'Methane, haze, and high-altitude clouds shape its blue appearance and dynamic weather.',
    surface: 'Neptune has no solid surface; deeper layers transition into hot, dense fluids rich in water, ammonia, and methane.',
    exploration: 'Voyager 2 is the only spacecraft to fly by Neptune, revealing storms, rings, and Tritons unusual geology.',
    aiPrompts: [
      'Why are Neptunes winds so fast?',
      'How was Neptune discovered mathematically?',
      'Why is Triton probably a captured object?',
    ],
  },
  '999': {
    summary: 'Pluto is a dwarf planet in the Kuiper Belt, with a surprisingly varied icy surface and a large moon, Charon.',
    atmosphere: 'Its thin nitrogen atmosphere expands and collapses over long seasonal cycles.',
    surface: 'Pluto has nitrogen ice plains, water-ice mountains, methane frost, and evidence of geologic activity.',
    exploration: 'New Horizons transformed Pluto from a distant point of light into a complex world.',
    aiPrompts: [
      'Why is Pluto classified as a dwarf planet?',
      'What did New Horizons discover at Pluto?',
      'How is Pluto different from the major planets?',
    ],
  },
};

export const DEFAULT_MOON_PROFILE: PlanetProfile = {
  summary: 'This moon is part of a larger planetary system, so its motion and environment are best understood relative to its parent planet.',
  atmosphere: 'Most moons have little or no atmosphere, though some have tenuous exospheres or dense atmospheres in special cases.',
  surface: 'Surface conditions depend on composition, impact history, tidal heating, and distance from the Sun.',
  exploration: 'Moons are key targets for understanding planetary formation, tidal heating, and potential subsurface oceans.',
  aiPrompts: [
    'How does this moon orbit its parent planet?',
    'What would gravity feel like on this moon?',
    'Could this moon have liquid water below the surface?',
  ],
};

export const DEFAULT_BODY_PROFILE: PlanetProfile = {
  summary: 'This object is shown with live or simulated ephemeris context, so its position, motion, and scale can be compared in the scene.',
  atmosphere: 'Atmospheric details vary by object and may not be available for every body in the current catalog.',
  surface: 'Physical surface details are summarized from the catalog when available.',
  exploration: 'Use the AI Astronomer tab to ask contextual questions about this object, its orbit, and how it compares with Earth.',
  aiPrompts: [
    'How should I interpret this orbit?',
    'How does this object compare with Earth?',
    'What makes this object scientifically interesting?',
  ],
};

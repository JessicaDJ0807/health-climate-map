"use client";

import dynamic from "next/dynamic";

// MapLibre needs `window`, so skip server prerendering for the map.
const NycMap = dynamic(() => import("./NycMap"), { ssr: false });

export default NycMap;

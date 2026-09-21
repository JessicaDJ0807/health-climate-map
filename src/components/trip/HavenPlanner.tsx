"use client";

// The HavenPath UI as delivered by the design team, driven by our routing and
// scoring engine. The markup mirrors HavenPath-Web-Version/dist/index.html so
// their stylesheets apply unchanged; every number shown is computed, not the
// sample data their prototype shipped with.
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { ProfileId } from "@/lib/trip/score";
import { answer, suggestions } from "@/lib/trip/assistant";
import { ENV_LAYERS, ENV_LAYER_IDS, type EnvLayerId } from "./envLayers";
import PlaceInput from "./PlaceInput";
import { profileIdFor, profileInsight, useDeviceProfile, type DeviceProfile, type Mobility, type Rest, type Shade } from "./useDeviceProfile";
import { DEMO_TRIPS, HOURS_AHEAD, hourLabel, useTrip } from "./useTrip";
import type { MapHandle } from "./TripMap";

const TripMap = dynamic(() => import("./TripMap"), { ssr: false });

type Drawer = "assistant" | "profile" | null;
type Message = { from: "haven" | "you"; text: string };

export default function HavenPlanner() {
  const trip = useTrip();
  const { profile: device, save: saveProfile, clear: clearProfile } = useDeviceProfile();
  const { result, status, cond } = trip;

  const [layer, setLayer] = useState<EnvLayerId>("trees");
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [trayOpen, setTrayOpen] = useState(false);
  const [modal, setModal] = useState<{ title: string; body: React.ReactNode } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const mapRef = useRef<MapHandle>(null);

  // The saved profile is the only thing that picks the scoring profile now;
  // the planner's profile chips were removed.
  const [suggested, setSuggested] = useState<ProfileId | null>(null);
  const wanted = profileIdFor(device);
  if (device.saved && wanted !== suggested) {
    setSuggested(wanted);
    if (wanted !== trip.profile) trip.changeProfile(wanted);
  }

  // Results arriving is the moment the tray is worth showing.
  const ready = status.state === "ready" && !!result;
  const [wasReady, setWasReady] = useState(false);
  if (ready !== wasReady) {
    setWasReady(ready);
    if (ready) setTrayOpen(true);
  }

  useEffect(() => {
    document.body.classList.toggle("map-expanded", expanded);
    return () => document.body.classList.remove("map-expanded");
  }, [expanded]);

  const active = ENV_LAYERS[layer];
  const initial = device.saved ? (device.name.trim().charAt(0) || "").toUpperCase() : "";
  // Their prototype showed a literal "?" before a profile exists; a person
  // glyph reads as an account control rather than as missing data.
  const avatar = initial || <PersonGlyph />;

  const showMethod = () =>
    setModal({
      title: "How HavenPath NY uses the data",
      body: (
        <>
          <p className="method-note">
            Estimated environmental exposure from public datasets. Supports route choice — not medical advice.
          </p>
          <div className="method-grid">
            {[
              ["♣ Trees & parks", "NYC Parks Forestry tree inventory, updated continuously and including park interiors. Living trees within 15 m of a sampled point; three or more counts as fully shaded. Large parks keep a 70% shade floor."],
              ["▥ Traffic proxy", "NYC DOT truck routes. A sampled point within 30 m counts as near traffic; this doubles as the near-road coarse-particle proxy."],
              ["◌ Air", `NYC Environment & Health Data Portal annual PM2.5 and NO₂ by community district (${trip.summary?.airYear ?? "2025"}). Relative to other NYC neighborhoods, not a health threshold.`],
              ["☀ Heat & sun", "Heat Vulnerability Index surface temperature by neighborhood, with the National Weather Service hourly forecast and computed sun position."],
              ["↗ Walking routes", "OpenStreetMap via Valhalla pedestrian routing, sampled every 25 m. Options more than 35% or 8 minutes slower than the fastest are dropped."],
            ].map(([t, b]) => (
              <article key={t}>
                <strong>{t}</strong>
                <span>{b}</span>
              </article>
            ))}
          </div>
        </>
      ),
    });

  return (
    <>
      <a className="skip-link" href="#main">Skip to navigation</a>

      <div className="app-shell">
        <header className="topbar">
          <button className="brand" type="button" onClick={() => { setTrayOpen(false); setDrawer(null); }}>
            <span className="brand-mark" aria-hidden="true">
              <svg viewBox="0 0 44 44">
                <path d="M7 31c9 0 9-18 22-18 4 0 7 1 9 3" />
                <circle cx="7" cy="31" r="3" />
                <circle cx="38" cy="16" r="3" />
                <text x="22" y="28">NY</text>
              </svg>
            </span>
            <span><strong>HavenPath <em>NY</em></strong><small>Lower-exposure walking</small></span>
          </button>
          <div className="top-actions">
            <button
              className={`pill-button assistant-button${drawer === "assistant" ? " active" : ""}`}
              type="button"
              aria-pressed={drawer === "assistant"}
              onClick={() => setDrawer(drawer === "assistant" ? null : "assistant")}
            >
              <span className="button-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <path d="M4 13v-1a8 8 0 0 1 16 0v1" />
                  <path d="M6 18H5a2 2 0 0 1-2-2v-2a2 2 0 0 1 2-2h1v6Zm12 0h1a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2h-1v6Z" />
                  <path d="M18 18c0 2-1.5 3-4 3h-1" />
                  <circle cx="11.5" cy="21" r="1" />
                </svg>
              </span>
              <span>Assistant</span>
            </button>
            <button
              className={`profile-chip${drawer === "profile" ? " active" : ""}`}
              type="button"
              aria-pressed={drawer === "profile"}
              aria-label="Open profile"
              onClick={() => setDrawer(drawer === "profile" ? null : "profile")}
            >
              <span className="avatar" aria-hidden="true">{avatar}</span>
              <span>{device.saved ? device.name : "Profile"}</span>
            </button>
          </div>
        </header>

        <main id="main">
          <section className="route-screen screen active">
            <div className="workspace-grid">
              <aside className="control-panel">
                <p className="eyebrow">New York City · walking only</p>
                <h1>Choose the gentler walk.</h1>

                <p className="field-label">Starting point</p>
                <PlaceInput
                  compact
                  label="Starting point"
                  marker="A"
                  value={trip.origin}
                  onChange={trip.setOrigin}
                  placeholder="Where from?"
                  near={trip.mapView}
                  onUseCurrentLocation={() => trip.pickCurrentLocation("origin")}
                />
                <p className="field-label">Destination</p>
                <PlaceInput
                  label="Destination"
                  marker="B"
                  value={trip.destination}
                  onChange={trip.setDestination}
                  placeholder="Where to?"
                  near={trip.mapView}
                  onUseCurrentLocation={() => trip.pickCurrentLocation("destination")}
                />
                {trip.locationError && <p className="status-note is-error">{trip.locationError}</p>}

                <div className="sample-trips">
                  {DEMO_TRIPS.map((t) => (
                    <button key={t.name} type="button" onClick={() => { trip.setOrigin(t.from); trip.setDestination(t.to); }}>
                      {t.short}
                    </button>
                  ))}
                </div>

                <div className="departure-row">
                  <div className="departure-head">
                    <span className="field-label">Leave at</span>
                    <strong>{trip.offset === 0 ? "Now" : hourLabel(trip.departure)}</strong>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={HOURS_AHEAD}
                    value={trip.offset}
                    aria-label="Departure time"
                    aria-valuetext={trip.offset === 0 ? "Now" : hourLabel(trip.departure)}
                    onChange={(e) => trip.changeOffset(Number(e.target.value))}
                  />
                </div>

                <button
                  className="primary-button full"
                  type="button"
                  disabled={!result}
                  aria-expanded={!!result && trayOpen}
                  onClick={() => setTrayOpen((v) => !v)}
                >
                  {status.state === "loading" ? "Finding walking routes\u2026" : "Compare walking routes"}
                </button>
                {status.state === "idle" && (
                  <p className="status-note">Search for a start and destination, or drop them on the map.</p>
                )}
                {status.state === "error" && <p className="status-note is-error">{status.message}</p>}

                {result && trayOpen && (
                  <section className="route-results" aria-labelledby="routesTitle">
                    <div className="route-results-head">
                      <p className="eyebrow">
                        {result.routes.length} walking route{result.routes.length === 1 ? "" : "s"}
                      </p>
                      <h2 id="routesTitle">{result.explanation}</h2>
                    </div>
                  <div className="route-cards">
                    {result?.routes.map((r) => {
                      const m = r.metrics;
                      const name = r.roles.map((role) => ({ fastest: "Fastest", leastTraffic: "Least traffic", shaded: "Most shaded" })[role]).join(" · ");
                      const rec = r.id === result.recommendedId;
                      return (
                        <article
                          key={r.id}
                          className={`route-card${rec ? " recommended" : ""}${r.id === trip.shownSelection ? " selected" : ""}`}
                          onClick={() => trip.setSelectedId(r.id)}
                        >
                          <span className="route-badge">{rec ? "Recommended · " : ""}{name.toUpperCase()}</span>
                          <span className="score" aria-label={`Estimated exposure ${m.exposure} of 100`}>{m.exposure}</span>
                          <h3>{Math.round(r.minutes)} min <small>· {r.km.toFixed(1)} km</small></h3>
                          <div className="expanded-metrics">
                            <span>♣ {Math.round(r.shade * 100)}% shade</span>
                            <span>☀ {Math.round(m.sunMinutes)} min sun</span>
                            <span>▥ {Math.round(m.trafficMinutes)} min traffic</span>
                            <span>◌ Air: {m.airLevel}</span>
                          </div>
                          <div className="exposure-label"><span>Estimated exposure</span><b>{m.exposure}/100</b></div>
                          <div className="exposure-track"><i style={{ width: `${Math.max(3, m.exposure)}%` }} /></div>
                          <p>
                            {rec
                              ? result.explanation
                              : r.extraMinutes > 0
                                ? `${Math.round(r.extraMinutes)} min longer than the fastest route.`
                                : "The shortest walking time of the options found."}
                          </p>
                          <button className="choose" type="button">
                            {r.id === trip.shownSelection ? "Showing on map" : "Show on map"}
                          </button>
                        </article>
                      );
                    })}
                  </div>
                    {result.routes.length < 3 && (
                      <p className="status-note">Some options are the same route here, so their labels are combined.</p>
                    )}
                  </section>
                )}

                <div className="condition-card">
                  <div className="section-heading">
                    <h2>Walking conditions</h2>
                    <button className="why-link" type="button" onClick={showMethod}>How?</button>
                  </div>
                  <div className="condition-list">
                    <div><span>☀ <b>Heat index</b></span><strong className={cond.heatFactor > 0.8 ? "risk-high" : undefined}>{trip.weatherLine}</strong></div>
                    <div><span>◐ <b>Sun factor</b></span><strong>{cond.sunFactor.toFixed(2)} · {trip.sunLine}</strong></div>
                    <div><span>♣ <b>Shade model</b></span><strong>TREES + PARKS</strong></div>
                  </div>
                </div>

                <button className="secondary-button full" type="button" onClick={showMethod}>
                  View data &amp; method
                </button>
              </aside>

              <section className="map-panel manhattan-panel" aria-label="New York City environmental map">
                <div className="map-toolbar">
                  <div><span className="live-dot" /> New York City · {active.label.toLowerCase()} layer</div>
                  <span className="source-pill">4 data layers</span>
                </div>
                <div className="map-canvas">
                  <figure className={`reference-map-view${expanded ? " expanded" : ""}`}>
                    <div className="live-map">
                      <TripMap
                        ref={mapRef}
                        origin={trip.origin}
                        destination={trip.destination}
                        routes={result?.routes ?? []}
                        recommendedId={result?.recommendedId ?? null}
                        selectedId={trip.shownSelection}
                        onSelect={trip.setSelectedId}
                        onPick={trip.pickOnMap}
                        onViewChange={trip.setMapView}
                        gradient={trip.gradient}
                        hoverPoint={trip.hoverPoint}
                        envLayer={layer}
                      />
                    </div>
                    <div className="map-layer-picker" role="group" aria-label="Environmental map layer">
                      {ENV_LAYER_IDS.map((id) => (
                        <button
                          key={id}
                          type="button"
                          className={layer === id ? "active" : undefined}
                          aria-pressed={layer === id}
                          onClick={() => setLayer(id)}
                        >
                          {ENV_LAYERS[id].label}
                        </button>
                      ))}
                    </div>
                    <div className="map-zoom-controls" aria-label="Map zoom controls">
                      <button type="button" aria-label="Zoom in" onClick={() => mapRef.current?.zoomIn()}>+</button>
                      <button type="button" aria-label="Zoom out" onClick={() => mapRef.current?.zoomOut()}>−</button>
                      <button type="button" aria-label="Reset map view" onClick={() => mapRef.current?.reset()}>⌂</button>
                      <button
                        type="button"
                        aria-label={expanded ? "Collapse map" : "Expand map"}
                        aria-pressed={expanded}
                        onClick={() => setExpanded((v) => !v)}
                      >
                        {expanded ? "×" : "⛶"}
                      </button>
                    </div>
                    <div className="map-gesture-hint">Drag · Zoom · Click to set A and B</div>
                  </figure>
                  <div className="map-layer-legend" aria-live="polite">
                    <strong>{active.label}</strong>
                    {active.legend}
                    <div className="legend-ramp">
                      {active.palette.map((c) => <i key={c} style={{ background: c }} />)}
                      <span>{active.scale}</span>
                    </div>
                  </div>
                </div>
              </section>
            </div>

          </section>
        </main>

      </div>


      <div className="scrim" hidden={!drawer && !modal} onClick={() => { setDrawer(null); setModal(null); }} />

      <AssistantDrawer
        open={drawer === "assistant"}
        onClose={() => setDrawer(null)}
        name={device.saved ? device.name : ""}
        result={result}
        cond={cond}
        profileId={trip.profile}
      />

      <ProfileDrawer
        open={drawer === "profile"}
        onClose={() => setDrawer(null)}
        profile={device}
        onSave={saveProfile}
        onClear={clearProfile}
        avatar={avatar}
      />

      {modal && (
        <div className="modal" role="dialog" aria-modal="true" aria-label={modal.title}>
          <button className="close-button modal-close" type="button" onClick={() => setModal(null)} aria-label="Close">×</button>
          <p className="eyebrow">Data &amp; method</p>
          <h2>{modal.title}</h2>
          <div>{modal.body}</div>
          <button className="primary-button" type="button" onClick={() => setModal(null)}>Got it</button>
        </div>
      )}
    </>
  );
}

function AssistantDrawer({
  open, onClose, name, result, cond, profileId,
}: {
  open: boolean; onClose: () => void; name: string;
  result: ReturnType<typeof useTrip>["result"];
  cond: ReturnType<typeof useTrip>["cond"];
  profileId: ProfileId;
}) {
  const greeting = name
    ? `Hi ${name}. Ask me about the routes on screen — I read the same numbers as the cards.`
    : "Ask me about the routes on screen — I read the same numbers as the cards.";
  const [log, setLog] = useState<Message[]>([{ from: "haven", text: greeting }]);
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [log]);

  const ask = (q: string) => {
    const text = q.trim();
    if (!text) return;
    setLog((l) => [...l, { from: "you", text }, { from: "haven", text: answer(text, result, cond, profileId).text }]);
    setDraft("");
  };

  return (
    <aside id="assistantDrawer" className={`drawer${open ? " open" : ""}`} aria-hidden={!open} aria-label="Haven assistant">
      <div className="drawer-head">
        <div className="haven-icon">H</div>
        <div><h2>Haven</h2><p>Answers from the routes on screen</p></div>
        <button className="close-button" type="button" onClick={onClose} aria-label="Close assistant">×</button>
      </div>
      <div className="chat-log" aria-live="polite">
        {log.map((m, i) => (
          <div key={i} className={`message ${m.from === "haven" ? "haven" : "user"}`}>{m.text}</div>
        ))}
        <div ref={endRef} />
      </div>
      <div className="suggestion-chips">
        {suggestions(result, cond).map((s) => (
          <button key={s} type="button" onClick={() => ask(s)}>{s}</button>
        ))}
      </div>
      <form className="chat-input" onSubmit={(e) => { e.preventDefault(); ask(draft); }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="Message Haven"
          placeholder="Ask Haven a question…"
        />
        <button type="submit" aria-label="Send message">↑</button>
      </form>
      <p className="medical-note">
        Haven answers from this trip&apos;s computed data only. It is not a language model and not medical advice.
      </p>
    </aside>
  );
}

function ProfileDrawer({
  open, onClose, profile, onSave, onClear, avatar,
}: {
  open: boolean; onClose: () => void; profile: DeviceProfile;
  onSave: (p: DeviceProfile) => void; onClear: () => void; avatar: React.ReactNode;
}) {
  const [draft, setDraft] = useState(profile);
  const [feedback, setFeedback] = useState("");
  const [seen, setSeen] = useState(profile);
  if (profile !== seen) { setSeen(profile); setDraft(profile); }
  const set = <K extends keyof DeviceProfile>(k: K, v: DeviceProfile[K]) => setDraft((d) => ({ ...d, [k]: v }));

  return (
    <aside id="profileDrawer" className={`drawer${open ? " open" : ""}`} aria-hidden={!open} aria-label="Your profile">
      <div className="drawer-head">
        <div className="avatar large-avatar">{avatar}</div>
        <div><h2>Your profile</h2><p>Used to rank and explain every route</p></div>
        <button className="close-button" type="button" onClick={onClose} aria-label="Close profile">×</button>
      </div>

      <div className="signed-in-profile">
        <div className="personalization-note">
          <span>✦</span>
          <div><strong>Route personalization</strong><p>{profileInsight(profile)}</p></div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSave({ ...draft, saved: true });
            setFeedback(profile.saved ? "Profile saved." : "Profile created. Routes are now ranked for you.");
          }}
        >
          <div className="profile-grid">
            <label className="profile-field wide">
              <span>Name</span>
              <input value={draft.name} onChange={(e) => set("name", e.target.value)} autoComplete="name" required />
            </label>
            <label className="profile-field">
              <span>Age</span>
              <input type="number" min={13} max={110} value={draft.age} onChange={(e) => set("age", Number(e.target.value))} required />
            </label>
            <label className="profile-field">
              <span>Mobility</span>
              <select value={draft.mobility} onChange={(e) => set("mobility", e.target.value as Mobility)}>
                <option value="independent">Independent</option>
                <option value="moderate">Moderate</option>
                <option value="limited">Limited</option>
              </select>
            </label>
            <label className="profile-field">
              <span>Shade</span>
              <select value={draft.shadePreference} onChange={(e) => set("shadePreference", e.target.value as Shade)}>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </label>
            <label className="profile-field">
              <span>Rest stops</span>
              <select value={draft.restPreference} onChange={(e) => set("restPreference", e.target.value as Rest)}>
                <option value="frequent">Frequent</option>
                <option value="sometimes">Sometimes</option>
                <option value="minimal">Minimal</option>
              </select>
            </label>
          </div>

          <div className="health-choice-grid">
            <label>
              <input type="checkbox" checked={draft.asthma} onChange={(e) => set("asthma", e.target.checked)} />
              <span><b>Asthma / air sensitive</b><small>Favor cleaner air and fewer truck routes</small></span>
            </label>
            <label>
              <input type="checkbox" checked={draft.heatSensitive} onChange={(e) => set("heatSensitive", e.target.checked)} />
              <span><b>Heat sensitive</b><small>Favor shade and less direct sun</small></span>
            </label>
          </div>

          <button className="primary-button full" type="submit">
            {profile.saved ? "Save profile" : "Create my profile"}
          </button>
          {feedback && <p className="auth-feedback">{feedback}</p>}
        </form>

        {profile.saved && (
          <button
            className="sign-out-button"
            type="button"
            onClick={() => { onClear(); setFeedback("Profile removed from this device."); }}
          >
            Delete profile from this device
          </button>
        )}

        <p className="privacy-note">
          <span>⌁</span>
          <span>
            Your profile stays on this device. There is no account and nothing is sent to a server, so HavenPath
            never asks for a password.
          </span>
        </p>
      </div>
    </aside>
  );
}

/** A neutral account mark, used until the person saves a name. */
function PersonGlyph() {
  return (
    <svg className="person-glyph" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="8.6" r="3.7" />
      <path d="M4.9 20.2c.9-3.9 3.7-5.9 7.1-5.9s6.2 2 7.1 5.9" />
    </svg>
  );
}

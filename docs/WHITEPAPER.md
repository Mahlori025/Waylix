# Every Road Remembers

### Waylix and the Hazard Fusion Engine: Crowd-Sensed Road Intelligence from Pavement to Airspace

**AIDotLix White Paper · WP-2026-03 · Version 0.1 · November 2026**
Author: Mahlori Lloyd Chauke (AIDotLix), Johannesburg, South Africa

---

## Abstract

Road hazards are a dynamic dataset. Most systems treat them as a static complaint log. Potholes appear after a storm, traffic lights fail during load-shedding, and an accident clears within hours, yet the reporting tools available to South African road users are largely one-way forms with no confirmation, no expiry and no feedback into navigation. We present **Waylix**, a free, offline-capable map and navigation application for Android and iOS. Waylix is built on the **Waylix Hazard Fusion Engine (HFE)**, a platform-agnostic geospatial event engine. The HFE fuses heterogeneous observations (manual reports from drivers and pedestrians, passive accelerometer detections, and drone-camera detections projected to the ground) into a single hazard map with a calibrated confidence per hazard. Fusion uses a sceptical-prior log-odds model with three ingredients: per-reporter latest-statement counting for spam resistance, per-type exponential evidence decay, and Beta-posterior reporter reputation. The same zero-dependency engine runs on the phone, giving an offline optimistic view, and on the server, which holds the authoritative state as an event log that can be replayed. In synthetic tests (100,000 noisy observations of 5,000 hazard sites) the engine sustains about 85,000 ingests per second on a single core. It produces 1.009 fused hazards per true site and scores a 20 km route against the full hazard set in 2.4 ms. Waylix is the first AIDotLix product built so that drones, and later Visual Positioning System (VPS) devices, plug in as adapters rather than rewrites.

**Keywords:** crowdsensing, road-hazard detection, data fusion, offline navigation, OpenStreetMap, drones, visual positioning.

---

## 1. Introduction

South Africa's road network is roughly 750,000 km long, the longest in Africa. Its condition is a daily safety and economic problem. Estimates of the pothole count vary widely and are contested: industry speakers and the Automobile Association have cited figures above 25 million, while SANRAL has disputed that figure as implausible for the paved network. That disagreement is itself the point. **Nobody has a trustworthy, current map of road hazards.** The national Vala Zonke app has logged around 120,000 potholes, which its own reporting acknowledges is a fraction of the real number, partly because engagement in poorer areas is low. In Gauteng, provincial leadership has described about 65% of the provincial road network as being in poor condition.

Three gaps follow:

1. **No verification.** A single report is either trusted blindly or ignored. Duplicate reports inflate counts, and fixed hazards are never retired.
2. **No feedback into movement.** Reports go to a municipality. They rarely reach the next driver or pedestrian about to hit the same hole.
3. **No continuity across platforms.** Phones, dashcams, municipal surveys and drones each produce data in silos with incompatible models.

Waylix addresses all three. It is a navigation app that people want to open daily (free maps, offline maps, driving and walking directions), and it turns that daily use into a self-verifying hazard network.

## 2. System overview

Waylix is a TypeScript monorepo with three parts:

| Component | Role |
|---|---|
| `@waylix/engine` (HFE) | Zero-dependency library: taxonomy, spatial index, fusion, reputation, route risk, alerts, navigation tracking, offline sync, positioning fusion, drone adapter. |
| `@waylix/server` | REST API on Node with built-in SQLite. Stores an immutable event log of observations and votes; hazards are a projection rebuilt by replay. |
| Waylix app | Expo / React Native for Android and iOS. MapLibre Native renders free OpenStreetMap vector tiles (OpenFreeMap) with offline region packs; OSRM provides drive and walk routing; Photon provides search. |

The defining design decision is that **the engine is the product**. The phone and the server run the same fusion code. When a user reports a pothole with no signal, the phone fuses it locally and shows it immediately. When connectivity returns, the server fuses it with everyone else's evidence and the client converges on the server's view. Because the math is identical, there is no "offline mode" logic to drift out of sync.

## 3. The Hazard Fusion Engine

### 3.1 A universal observation

Every input, whatever its source, is reduced to one schema:

> *Observation* = ⟨id, type, position, accuracy, [altitude], time, reporter, platform ∈ {pedestrian, vehicle, cyclist, drone, fixed_sensor}, source ∈ {manual, accelerometer, camera_ai, drone_camera, lidar, import}, [severity], [detector confidence]⟩

The client-generated `id` doubles as an idempotency key, so retries after network failure never double-count.

### 3.2 Type physics

Each hazard type carries its own parameters: a merge radius *r* (how far apart two reports can be and still describe the same thing), an evidence half-life *τ*, a default severity, a point/zone kind, and the number of distinct reporters required for verification. A pothole uses *r* = 15 m and *τ* = 30 days. An accident uses *r* = 80 m and *τ* = 3 hours. A high-accident zone uses *r* = 400 m and *τ* = 180 days. The current taxonomy has 19 types across three **domains**: road, walkway and air. New platforms extend the system by adding rows to this table, not by adding code.

### 3.3 Association

An incoming observation is matched to the nearest open hazard of the same type and domain within *r* + min(σ, *r*), where σ is the observation's reported accuracy. Candidate hazards come from a geohash-bucketed spatial index (precision 6, cells of about 1.2 × 0.6 km). In the air domain, matching also requires overlapping altitude bands, so a crane at 40 m and a power line at 150 m above the same point stay separate.

### 3.4 Confidence as decayed log-odds

For hazard *h* we keep each reporter's **latest** statement *e* (a report, a confirmation or a dismissal). Confidence is

$$
\text{logit}\,P(h) \;=\; \beta_0 \;+\; \sum_{e \in \mathcal{L}(h)} s_e \; w_e \; T(\rho_e)\; 2^{-\Delta t_e/\tau}
$$

where β₀ = −1.5 is a sceptical prior; *s* = +1 for reports and confirmations and −1 for dismissals; *w* is the source weight (manual 1.2, accelerometer 0.45, drone camera 1.0, lidar 1.3, authority import 1.6), scaled by detector confidence and an accuracy penalty; and *T*(ρ) ∈ [0.25, 2] is the reporter's trust.

Four useful properties follow directly from this form:

- **Spam resistance.** One person tapping "report" fifty times contributes once, because only their latest statement counts.
- **Self-healing.** Unconfirmed evidence fades at the rate natural for its type. A hazard *expires* when the decayed positive evidence drops below 0.4 and at least one half-life has passed since the last positive report. It is *resolved* when dismissals outweigh support.
- **Graded trust.** States are *candidate* (P < 0.5), *active* (P ≥ 0.5), and *verified* (P ≥ 0.85 with enough distinct reporters). With default trust, one manual report is a candidate, two reporters make it active, and three verify it. One proven reporter can activate a hazard alone.
- **Sensor fusion.** Weak automated signals live on the same scale as human ones. Ten vehicles that each register an accelerometer jolt at the same spot (0.36 log-odds each) verify a pothole that nobody reported manually.

### 3.5 Reputation

Each reporter has a Beta(α, β) posterior, starting at Beta(2, 2). When a hazard becomes verified, its supporters gain α. When a hazard is refuted before it ever became active, its supporters gain β. Trust maps the posterior mean piecewise-linearly onto [0.25, 2.0]. Reputation is applied at evaluation time, so a reporter's improving record retroactively strengthens their open reports.

## 4. From map to movement

**Route risk.** A route's risk is Σ severity² · confidence over hazards whose effective radius intersects a corridor around the polyline (20 m for driving, 12 m for walking). Squaring severity makes one sinkhole outweigh a field of hairline cracks. Alternatives from the router are ranked by a generalised cost, *C* = duration + λ · risk, with λ = 6 s per risk unit by default. Users can switch the ranking off.

**Proximity alerts.** Look-ahead is time-based: max(60 m, *v* · 25 s), capped at 1.5 km. The same code therefore warns a pedestrian about 60 m ahead and a highway driver about 500 m ahead. With a route active, alerts follow the route's along-track distance; without one, they use a ±35° heading cone. Zones announce on entry ("Entering high-accident zone in 300 m"). Each hazard is announced at most once per 10 minutes.

**Offline-first navigation.** A `NavigationTracker` needs only the route geometry and the current fix. It computes progress, the next manoeuvre, ETA, arrival and off-route detection fully on-device. Successful routes are cached. When the router is unreachable, a cached route with nearby endpoints is served; failing that, a clearly labelled straight-line estimate is shown. MapLibre offline packs (zoom 10–16, bounded to 2,500 km²) are downloaded together with that area's hazards, so the map, alerts and an already-planned route all survive a dead zone.

## 5. Built for drones, ready for VPS

**Drones.** The `DroneObservationAdapter` converts an onboard vision model's detections into standard observations. Ground hazards are projected from pixel (*u*, *v*) to WGS-84 using a pinhole camera model, the drone's pose (position, altitude above ground, yaw, gimbal pitch) and a flat-ground assumption. The adapter attaches an error estimate that grows with slant range. Air-domain hazards are placed at the drone's own position and altitude. Our tests show a drone's projected pothole fusing into the same hazard a driver reported. A route survey by drone and a commute by car therefore build **one** map. A `fly` travel mode with direct-line routing is already included, so drone path planning can reuse the route-risk scoring against air-domain hazards.

**Visual Positioning (VPS).** All positioning flows through a `PositionFuser` that blends the freshest fix from each source by inverse variance and rejects physically impossible jumps. A 0.5 m VPS fix outweighs a 10 m GNSS fix by about 400×, so VPS dominates whenever the camera is tracking, and GNSS takes over smoothly when it isn't. VPS integration is therefore a new `PositionSource`, with no changes downstream. It is the path to lane-level hazard placement and pedestrian AR guidance.

## 6. Implementation and evaluation

The engine has no runtime dependencies and runs unchanged in Node 22, Hermes (React Native) and browsers. The server is event-sourced: on boot it replays observations and votes in arrival order, reusing the hazard IDs recorded in the log so client references stay stable across restarts. The test suite covers 43 cases (35 engine, 8 API). These include spam resistance, decay per type, dismissal and resolution, reputation feedback, altitude separation, drone projection, offline outbox survival across app restarts, incremental `since` sync including closures, and replay determinism. Both the Android and iOS JavaScript bundles compile in CI.

**Synthetic benchmark** (single core, Node 22): 100,000 observations from 20,000 simulated reporters. 30% were weak accelerometer events. Each observation was placed with 6 m Gaussian noise around one of 5,000 true sites over a 30 km radius around Johannesburg.

| Metric | Result |
|---|---|
| Ingest throughput | ~84,800 observations/s |
| Fused hazards per true site | 1.009 (≈99% correctly merged) |
| 2 km radius query | 0.014 ms |
| Risk scoring of a 20 km, 400-vertex route | 2.4 ms |

At these rates a single engine instance handles a metro-scale deployment. Geohash prefixes give a natural shard key: the PostGIS schema partitions by 5-character geohash, so cities or provinces can be assigned to separate engine workers.

## 7. Privacy, safety and fair use

Reporters are random anonymous IDs. Waylix stores no accounts, names or location traces, only the point of each report. The app never asks for input while a route is being driven beyond a single large "Report hazard here" button, and audio and haptic alerts mean the driver's eyes stay on the road. Sensitive categories such as crime hotspots require five independent reporters before verification. The default map, routing and search services are free community infrastructure (OpenFreeMap, FOSSGIS OSRM at about one request per second, and komoot Photon). Self-hosting recipes for production are included.

## 8. Limitations and future work

The v0.1 limits are explicit. Offline *re*-routing needs an on-device routing graph, planned via Valhalla tiles. Drone projection assumes flat ground, and a DEM will remove that assumption. The source weights and thresholds are engineering priors that must be calibrated against field ground truth. Accelerometer detection cannot yet tell potholes from speed bumps, which motivates combining it with OSM traffic-calming tags and an on-device vision model. The roadmap, in order, is: (1) VPS positioning, (2) photo evidence with on-device pothole and crack detection, (3) a drone survey mission planner, (4) a municipal dashboard with a closed-loop "fixed" status and work-order export, and (5) a field pilot in Johannesburg to calibrate the fusion model.

## 9. Conclusion

Waylix reframes road-hazard reporting as a **fusion problem**. Every observation is evidence, every hazard carries a probability, and every probability decays unless the world keeps confirming it. By giving people a navigation app worth using daily, and by keeping one engine across phone, server and drone, Waylix can turn millions of ordinary journeys into a living, self-verifying map of what is dangerous on the road right now. Every road remembers. Waylix makes sure the next traveller does too.

---

### References

1. Daily Maverick, "Potholes in South Africa grow from 15 million to 25 million in just five years, SA roads federation reveals," Oct. 2023.
2. The Citizen / SANRAL, "Sanral denies claims of 25 million potholes on SA's roads," 2023.
3. IOL, "South Africa's pothole crisis: the impact of poor workmanship on road infrastructure," May 2025 (Vala Zonke statistics).
4. TopAuto, "65% of the roads are broken in this South African province," 2025.
5. Daily News, "Over 25 million potholes threaten South African motorists, warns AA," Apr. 2025.
6. OpenFreeMap. Free OpenStreetMap vector-tile hosting. https://openfreemap.org
7. FOSSGIS e.V., routing server terms of use (routing.openstreetmap.de), https://fossgis.de/arbeitsgruppen/osm-server/nutzungsbedingungen
8. D. Luxen and C. Vetter, "Real-time routing with OpenStreetMap data," *Proc. ACM SIGSPATIAL GIS*, 2011 (OSRM).
9. J. Eriksson et al., "The Pothole Patrol: using a mobile sensor network for road surface monitoring," *Proc. ACM MobiSys*, 2008.
10. A. Mednis et al., "Real time pothole detection using Android smartphones with accelerometers," *IEEE DCOSS*, 2011.

*© 2026 AIDotLix. Waylix and the Waylix Hazard Fusion Engine are products of AIDotLix.*

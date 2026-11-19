# Every Road Remembers

### Can Crowd-Sensed Road Hazards Ground Outdoor Augmented Reality? Four Research Questions Answered with Waylix, and an Outlook on Visual Positioning

**AIDotLix White Paper · WP-2026-03 · Version 1.3 · November 2026**
Author: Mahlori Lloyd Chauke (AIDotLix), Johannesburg, South Africa

---

## Abstract

Recent research on augmented reality (AR) navigation and AR head-up displays has made real progress on *how* to show a hazard. Two problems remain open: *where trustworthy hazard content comes from*, and *how precisely it can be anchored outdoors*. In this paper I ask whether crowd-sensed road-hazard reports can become AR-grade content. I frame four research questions on content, registration, presentation and transfer to drones, and answer them with **Waylix**, an AIDotLix navigation app, and its **Hazard Fusion Engine**, which I designed and built following a design-science approach. Simulations on the production engine show that a hazard's fused position error falls as 6/√*n* metres with *n* independent reports, from 6.1 m with one report to 1.9 m with ten. An angular registration model built on those figures shows that GNSS-only phones misplace a pothole by 10–22° at walking distances. That is adequate for zones and driving cues but not for pinning point hazards. Point-accurate AR becomes possible only when *both* the viewer's device and the original reports are positioned visually: the error at 35 m then falls to 1.3°, inside the 1.6° a one-metre pothole occupies in view. I close with a Visual Positioning System (VPS) outlook grounded in visual-localisation research from 2021–2023, including localisation against OpenStreetMap itself. It sets out a phased, privacy-preserving path from today's GNSS app to lane-level AR hazard warnings.

**Keywords:** augmented reality, visual positioning, registration error, mobile crowdsensing, situation awareness, uncertainty visualisation, road safety.

---

## 1. Introduction

I am an electrical engineer in Johannesburg. Like everyone who drives or walks here, I navigate around potholes, missing manhole covers and dark intersections every day. Most of these hazards are known to *somebody*, but that knowledge rarely reaches the next person on the road in time. When I started Waylix, I saw a reporting and navigation problem. The deeper I went, the more it looked like an augmented reality problem.

Azuma's classic definition still frames the field: AR combines real and virtual content, is interactive in real time, and is registered in three dimensions [1]. What has changed is the evidence base. A 2023 systematic review of 107 AR navigation applications found that the field has matured in hardware and platforms but remains uneven in evaluation methodology [2]. A 2025 review of AR wayfinding found that AR's performance benefits are consistently demonstrated indoors, while similar advantages have not been found outdoors [3]. A 2025 meta-analysis put AR's overall benefit to navigation at a moderate effect size (SMD 0.554), with a much larger effect for wayfinding (0.992) than for driving navigation (0.246) [4]. Outdoor, on-road AR is therefore exactly where the open questions are.

For drivers, AR head-up displays (AR-HUDs) bring a specific risk. Wang et al. showed that an AR-HUD reduces inattentional blindness to pedestrians it augments but increases it for pedestrians it does not [5]. Chen et al. found that where a hazard falls relative to the AR graphic changes whether drivers notice it at all [6]. Huo and Rubanka found that drivers come to depend on AR warnings, and that a warning failure exposes poorly calibrated trust [7]. For pedestrians, Tabone et al. surveyed 992 people on AR interfaces for road crossing [8], and Malik et al. found that AR overlays changed street-crossing decisions and reduced reported mental and physical demand for older adults [9].

All of this work assumes the system already *knows* where the danger is, from vehicle sensors or a curated map. On the roads I drive, no such map exists. Meanwhile, the crowdsensing literature has shown that phones can sense road damage. Dong and Li detected surface defects from low-rate smartphone accelerometer data [10]. Daraghmi et al. built crowdsourced road-surface indices that correct for vehicle effects [11]. Xin et al. fused accelerometer and video data from crowdsourced phones to detect potholes [12]. Alzamzami et al. detected potholes from drone imagery with YOLOv8 [13]. OpenStreetMap has become a mature, multidisciplinary research platform in its own right [14], and reputation-based truth discovery has become a standard defence against low-quality crowdsensed data [15]. What I could not find was work connecting these streams: **crowd-sensed hazards characterised as content for outdoor AR.** That is this paper's gap.

## 2. Research questions

1. **RQ1 (content).** Can noisy, unverified, duplicated crowd reports be turned into AR-grade content, meaning hazards with a quantified probability of existing and a quantified positional uncertainty?
2. **RQ2 (registration).** What positioning accuracy is needed to anchor such hazards in a handheld AR view? Is GNSS enough, or is a Visual Positioning System required?
3. **RQ3 (presentation).** How should uncertain, time-decaying hazards be shown so that they improve situation awareness without inviting over-reliance?
4. **RQ4 (transfer).** Can the same pipeline serve aerial platforms (drones), both as sensors and as AR users?

## 3. Method

I followed design science research [16]: build an artefact that addresses a relevant problem, then evaluate it rigorously. The artefact is Waylix, an Android and iOS app on OpenStreetMap data [14] with offline maps and drive/walk routing, together with its Hazard Fusion Engine. I evaluate it in four ways. First, analytically, by deriving the registration error a user would see. Second, by simulation: every figure in Section 5 comes from running the production engine code (`packages/engine/bench/ar-study.ts` in the repository), not from a separate model. Third, through an end-to-end run of the app itself: its real React Native interface, rendered in Chrome via react-native-web against the live API server and scripted through twelve screens (`apps/mobile/web-preview/`). Fourth, through a planned user study, which I set out in Section 7. Throughout, I state which answers are established by the first three methods and which still await the fourth.

## 4. The artefact in brief

Every input, whether a tap, an accelerometer jolt or a drone detection, is reduced to one observation schema: type, position, accuracy, time, reporter, platform and source. Reports of the same type within a type-specific merge radius are fused into one hazard.

For existence, I use the log-odds evidence accumulation that Moravec and Elfes introduced for occupancy-grid mapping [17]. Evidence adds in log-odds space, and a sceptical prior keeps a single report from being taken as fact:

$$
\text{logit}\,P(h) = \beta_0 + \sum_{e} s_e\, w_e\, T(\rho_e)\, 2^{-\Delta t_e/\tau}
$$

Each reporter's latest statement *e* counts once, which resists spam. Its sign *s* is positive for a report or confirmation and negative for a dismissal. Its weight *w* reflects the source (manual 1.2, accelerometer 0.45, drone camera 1.0). The evidence decays with a half-life *τ* specific to the hazard type, so an accident fades in hours and a pothole lasts for weeks. Reporter trust *T* comes from a Beta reputation posterior [18], the same family of ideas as recent reputation-based truth discovery in mobile crowdsensing [15].

Position is fused by inverse-variance weighting, and the same principle blends GNSS and, in future, VPS fixes on the device. A hazard therefore carries two numbers AR can use: *P(h)* and a positional spread σ. The engine runs identically on the phone (offline) and on the server, and 56 automated tests cover the engine and API.

## 5. Findings

### 5.1 RQ1: crowd reports can become AR-grade content

I ran 2,000 trials per condition. Each trial fused *n* independent pothole reports, each with 6 m RMS horizontal error. That is an *optimistic* open-sky assumption: reviews of smartphone GNSS document how phone hardware, antennas and holding modes limit accuracy [19], and the internal positioning solution of phones in realistic handheld, dashboard and urban settings can be off by several tens of metres or more [20].

| Reports *n* | Fused RMS error | 95th percentile | Theory 6/√*n* |
|---|---|---|---|
| 1 | 6.05 m | 10.63 m | 6.00 m |
| 3 | 3.45 m | 5.92 m | 3.46 m |
| 10 | 1.90 m | 3.27 m | 1.90 m |
| 20 | 1.41 m | 2.27 m | 1.34 m |

The engine follows the theoretical 1/√*n* law of independent averaging, so every extra reporter sharpens the location. With default settings, one report is a *candidate* (*P* ≈ 0.43), two reporters make it *active*, and three *verify* it (*P* > 0.85). **My answer to RQ1 is yes.** Fusion turns crowd reports into content with an explicit existence probability and a positional σ: the two quantities an AR renderer needs to decide *whether* to show a hazard and *how precisely* to place it.

### 5.2 RQ2: GNSS anchors zones; VPS is needed at both ends to pin points

An overlay drawn at distance *d* is misplaced by θ = atan(*e* / *d*), where *e* combines the device's position error with the hazard's own error. I converted θ into on-screen pixels for a typical phone camera (63° horizontal field of view, 1,080 px wide). For the hazard, I used a three-reporter pothole (σ = 3.45 m, from Table 1).

| Distance | Phone GNSS (σ = 5 m) | VPS on viewer only (σ = 0.5 m) | VPS viewer + VPS-anchored reports |
|---|---|---|---|
| 15 m | 22.0° (378 px) | 13.1° (224 px) | 2.9° (50 px) |
| 35 m | 9.8° (169 px) | 5.7° (97 px) | 1.3° (21 px) |
| 60 m | 5.8° (99 px) | 3.3° (57 px) | 0.7° (13 px) |
| 150 m | 2.3° (40 px) | 1.3° (23 px) | — |

A one-metre pothole subtends only 3.8° at 15 m and 1.6° at 35 m. Three conclusions follow.

- **GNSS is good enough for zones and for driving-distance cues.** A 400 m high-accident zone is mis-registered by only 1.5% of its radius at 150 m, and the engine warns about 418 m ahead at 60 km/h.
- **GNSS cannot pin a point hazard at walking distance.** At 15–35 m the error is several times larger than the pothole itself.
- **VPS on the viewer alone does not solve it,** which surprised me. Once the device is accurate, the hazard's crowd-sourced position becomes the dominant error. Point-accurate AR appears only when reports are *also* captured with VPS: three VPS-anchored reports (σ ≈ 0.58 m) bring the error at 35 m down to 1.3°, inside the pothole's own outline.

**My answer to RQ2:** GNSS is sufficient for zone-level and distance-banded AR. Pinned point-hazard AR needs VPS both when the hazard is reported and when it is viewed. This finding drives the outlook in Section 6.

### 5.3 RQ3: present uncertainty, design against over-reliance

Endsley's recent meta-analysis confirms that freeze-probe SAGAT measurement is sensitive to display design [21], which makes situation awareness a measurable target for these design choices. Uncertainty-visualisation research in AR is now directly relevant. Doula et al. found at ISMAR 2023 that *hiding* model uncertainty in AR led to lower driver engagement [22]. Scargill et al. showed that a phone's own pose-tracking error can be estimated without ground truth and visualised in place [23]. Combining these with the inattentional-blindness [5], [6] and over-reliance [7] findings and my RQ2 results, I derive five rules. Waylix's map layer already implements the first two in part.

1. **Encode confidence as opacity.** Candidates faded, verified hazards solid.
2. **Encode positional σ as footprint, not a pin.** Draw a ground disc whose radius is the fused σ, so the overlay never claims more precision than the data has.
3. **Switch representation on the registration test.** When θ exceeds the hazard's angular size, show a distance-and-direction cue ("pothole ahead, 35 m") rather than a world-locked marker. Pin only when θ is smaller, using the device's *live* pose-error estimate [23].
4. **Lead with audio for drivers; reserve handheld AR for pedestrians.** AR graphics change what drivers notice and what they miss [5], [6]. The engine's time-based look-ahead (about 60 m walking, about 418 m at 60 km/h) sets when each warning fires.
5. **Show coverage, not just hazards.** Drivers rely on AR warnings and are caught out when one fails [7]. A crowd-sourced map is never complete, so the interface must signal when an area has sparse or stale data. "No warning" must never read as "no hazard".

**My answer to RQ3** is these five rules, grounded in recent evidence and my measured registration limits. They are hypotheses until the study in Section 7 tests them.

### 5.4 RQ4: one pipeline transfers to drones

Drone imagery already detects potholes reliably with modern detectors [13]. In Waylix, a drone camera is just another sensor. Detections are projected from pixel coordinates to the ground using a pinhole camera model and the drone's pose, and the adapter attaches an error estimate that grows with slant range. Aerial hazards such as cables and cranes live in an *air* domain with altitude bands, so they never merge with ground hazards. In the engine's tests, a drone-detected pothole fuses into the same hazard a driver reported. **My answer to RQ4 is a qualified yes:** the data path transfers unchanged, and the same registration analysis applies to a drone operator's first-person view. Flat-ground projection and flight validation remain open.

## 6. VPS outlook: from GNSS to lane-level AR

RQ2 makes VPS the critical enabler, not an optional extra. Visual localisation estimates a camera's full 6-DoF pose by matching an image against a map. Research from 2021–2023 shows why it is now realistic for a product like Waylix, and what still stands in the way.

**Robustness is measurable.** Toft et al. extended benchmark datasets with ground-truth poses across day-night, weather and seasonal change, so robustness can now be quantified rather than assumed [24]. LaMAR re-centred evaluation on *AR* itself, building a benchmark from heterogeneous AR devices in large, unconstrained scenes [25]. Johannesburg's harsh sun, load-shedding darkness and summer storms are exactly the conditions these benchmarks probe.

**Maps no longer have to be 3D.** OrienterNet localises an image with sub-metre accuracy by matching it against 2D OpenStreetMap data, the same open maps people use to orient themselves [26]. To me this is the most important result for Waylix. The app already runs on OpenStreetMap [14], so a first VPS tier needs no expensive 3D city scan. That matters in African cities, where street-level 3D coverage is sparse.

**Each report can be its own anchor.** Map-free relocalisation estimates metric pose relative to a *single* reference image, and it scores methods by the reprojection error of virtual objects and by their confidence estimates [27]. These are exactly the quantities my RQ2 and RQ3 analysis needs. A photo attached to a hazard report could serve as that hazard's anchor, which is the "VPS at capture time" that RQ2 calls for.

**Hotspots can be mapped in minutes.** Accelerated Coordinate Encoding learns a scene-specific relocaliser in under five minutes of mapping, up to 300 times faster than earlier scene-coordinate regression [28]. Dense neural maps for high-risk corridors, such as taxi ranks, school routes and known accident zones, become feasible for a small team or a municipality.

**GNSS stays in the loop.** GVINS tightly fuses raw GNSS with visual and inertial data in a factor graph for drift-free global pose [29]. That is the natural successor to Waylix's current inverse-variance `PositionFuser`, and it keeps the system working when the camera is covered or the scene is featureless.

**Privacy must be designed in.** Dusmanu et al. showed that the local image features VPS uploads can be inverted to recover the original scene, and proposed privacy-preserving descriptors [30]. Waylix will never upload raw images for localisation, and anchor photos will be blurred and stripped of metadata on-device.

From this I set out a phased roadmap:

| Phase | Capability | Enabling work | Unlocks |
|---|---|---|---|
| 0 (today) | GNSS + crowd fusion | Waylix engine | Zones, audio cues, hazard map |
| 1 | OSM-based visual localisation on-device | OrienterNet [26] | Sub-metre heading and position for walkers |
| 2 | Anchor photo with each report | Map-free relocalisation [27] | VPS-anchored hazards (σ < 1 m) |
| 3 | Neural maps for hazard hotspots | ACE [28] | Pinned AR in high-risk corridors |
| 4 | Tight GNSS-visual-inertial fusion | GVINS [29], SiTAR [23] | Continuous pose with live error bounds |
| 5 | Drone-built maps and aerial AR | PDS-UAV [13], engine air domain | One map from road and sky |

The quantitative target for Phases 1–2 comes straight from Section 5.2: device σ ≤ 0.5 m *and* hazard σ ≤ 0.6 m for pinned AR at 35 m. That is the number I will hold every VPS candidate to.

## 7. Planned evaluation

To test the RQ3 rules, I will run a within-subjects study with pedestrians in Johannesburg. It compares a 2D map with audio alerts against an AR view following the five rules. Driving conditions will be simulated only, for safety. I will measure hazard identification time and accuracy; situation awareness with SAGAT [21]; and workload with instruments chosen according to Kosch et al.'s survey of cognitive-workload measurement in HCI [31]. My hypotheses are, first, that AR improves identification time without raising workload, and second, that the cue-to-pin switch (rule 3) prevents the false-precision errors a naive pin would cause.

## 8. Limitations

**Implementation status.** An internal review of v0.1 (November 2026) confirmed the core: the automated tests passed, both mobile bundles compiled, and the scripted run reproduced the paper's behaviour in the live app. A walker's route through Braamfontein listed both known hazards on the way, and the alert fired "Pothole ahead in 40 m" at the predicted distance. The same run exposed three interface defects: a newly synced report missing from the map until the next pull, a navigation banner that waited for the next GPS fix, and arrival wording shown too early. Version 0.2 fixes all three, and a fresh scripted run confirms each fix on screen. It also moves the turn-by-turn logic into a tested engine component, so the same session logic can later drive an AR view. No native build has yet run on a physical phone, so sensor and offline-map behaviour remains unverified.

**Identity is the weakest assumption.** Spam resistance in Section 4 counts each *reporter ID* once, but in v0.1 the client chose its own anonymous ID. One person minting IDs could verify a false hazard with three of them, or resolve a real one with two dismissals. This is a Sybil attack, and it bounds every confidence figure in this paper, because reputation-based truth discovery [15] assumes identities are costly to create. Version 0.2 raises that cost in three ways. Identities are now issued and signed by the server, and any ID the client claims is ignored. Each network may register only a few devices per day. And devices without platform attestation start at lower trust, so three of them can no longer verify a hazard alone (an automated test checks this). The residual risk is someone with many networks or many genuine phones. Closing it needs the attestation hook wired to Google Play Integrity and Apple App Attest, which is the remaining requirement before a public pilot.

**Model and data.** My registration figures rest on simulation with an optimistic GNSS model. Real smartphone errors are larger, heavier-tailed and correlated between nearby reporters [19], [20], which would slow the 1/√*n* gain and strengthen the case for VPS. The source weights and decay half-lives are engineering priors that need field calibration. Accelerometer evidence cannot yet tell a pothole from a speed bump, a known weakness that motivates multi-sensor fusion [12]. The AR rendering layer and the VPS phases are designed, not yet built. Waylix today delivers the fusion engine, the hazard map, offline navigation and audio alerts on which they will sit.

## 9. Conclusion

I set out to find whether ordinary road users' reports can carry the weight of augmented reality. They can, if we treat them as evidence rather than fact. Fusion gives every hazard a probability and a spread. Registration analysis shows which hazards GNSS can anchor and which need VPS, at capture as well as at viewing. Recent work on visual localisation, from OpenStreetMap-based localisation to map-free relocalisation, shows the path is open. Every road remembers. With Waylix, I want the next person on that road to see what it remembers.

---

### References

*Foundational works are marked †; all other references are peer-reviewed papers from 2021–2025.*

1. † R. T. Azuma, "A survey of augmented reality," *Presence: Teleoperators and Virtual Environments*, vol. 6, no. 4, pp. 355–385, 1997.
2. K. Cheliotis, F. Liarokapis, M. Kokla, E. Tomai, *et al.*, "A systematic review of application development in augmented reality navigation research," *Cartography and Geographic Information Science*, 2023, doi: 10.1080/15230406.2023.2194032.
3. Z. Qiu, A. Mostafavi, and S. Kalantari, "Use of augmented reality in human wayfinding: a systematic review," *Virtual Reality*, 2025, doi: 10.1007/s10055-025-01226-w.
4. S. S. Man, P. Su, C. Xiao, H. Yun, and A. H. S. Chan, "Effectiveness of augmented reality technology in improving navigation performance: a systematic review and meta-analysis," *Ergonomics*, 2025, in press.
5. Y. Wang, Y. Wu, C. Chen, *et al.*, "Inattentional blindness in augmented reality head-up display-assisted driving," *Int. J. Human–Computer Interaction*, vol. 38, no. 9, pp. 837–850, 2022.
6. W. Chen, J. Song, Y. Wang, C. Wu, S. Ma, D. Wang, Z. Yang, and H. Li, "Inattentional blindness to unexpected hazard in augmented reality head-up display assisted driving: the impact of the relative position between stimulus and augmented graph," *Traffic Injury Prevention*, vol. 24, no. 4, pp. 344–351, 2023.
7. F. Huo and A. Rubanka, "Differences in drivers' dependence on AR warning information in urban driving environments: the role of driving experience," *Frontiers in Virtual Reality*, vol. 6, 2025, doi: 10.3389/frvir.2025.1638823.
8. W. Tabone, R. Happee, J. García, Y. M. Lee, M. L. Lupetti, N. Merat, and J. C. F. de Winter, "Augmented reality interfaces for pedestrian–vehicle interactions: an online study," *Transportation Research Part F*, vol. 94, pp. 170–189, 2023.
9. J. Malik, N.-Y. Kim, M. D. N. Parr, J. K. Kearney, J. M. Plumert, and K. Rector, "Do simulated augmented reality overlays influence street-crossing decisions for non-mobility-impaired older and younger adult pedestrians?" *Human Factors*, vol. 66, no. 5, pp. 1520–1530, 2024.
10. D. Dong and Z. Li, "Smartphone sensing of road surface condition and defect detection," *Sensors*, vol. 21, no. 16, art. 5433, 2021.
11. Y.-A. Daraghmi, T.-H. Wu, and T.-U. Ik, "Crowdsourcing-based road surface evaluation and indexing," *IEEE Trans. Intelligent Transportation Systems*, vol. 23, no. 5, 2022.
12. H. Xin, Y. Ye, X. Na, H. Hu, G. Wang, C. Wu, and S. Hu, "Sustainable road pothole detection: a crowdsourcing based multi-sensors fusion approach," *Sustainability*, vol. 15, no. 8, art. 6610, 2023.
13. O. Alzamzami, A. Babour, W. Baalawi, and L. Al Khuzayem, "PDS-UAV: a deep learning-based pothole detection system using unmanned aerial vehicle images," *Sustainability*, vol. 16, no. 21, art. 9168, 2024.
14. A. Y. Grinberger, M. Minghini, L. Juhász, G. Yeboah, and P. Mooney, "OSM Science—the academic study of the OpenStreetMap project, data, contributors, community, and applications," *ISPRS Int. J. Geo-Information*, vol. 11, no. 4, art. 230, 2022.
15. J. Li, B. Gu, S. Gong, Z. Su, and M. Guizani, "Can we enhance the quality of mobile crowdsensing data without ground truth?" *IEEE Trans. Mobile Computing*, 2025, doi: 10.1109/TMC.2025.3526277.
16. † A. R. Hevner, S. T. March, J. Park, and S. Ram, "Design science in information systems research," *MIS Quarterly*, vol. 28, no. 1, pp. 75–105, 2004.
17. † H. Moravec and A. Elfes, "High resolution maps from wide angle sonar," in *Proc. IEEE ICRA*, 1985, pp. 116–121.
18. † A. Jøsang and R. Ismail, "The beta reputation system," in *Proc. 15th Bled Electronic Commerce Conf.*, 2002.
19. F. Zangenehnejad and Y. Gao, "GNSS smartphones positioning: advances, challenges, opportunities, and future perspectives," *Satellite Navigation*, vol. 2, no. 1, 2021.
20. G. Shinghal and S. Bisnath, "Conditioning and PPP processing of smartphone GNSS measurements in realistic environments," *Satellite Navigation*, vol. 2, art. 10, 2021.
21. M. R. Endsley, "A systematic review and meta-analysis of direct objective measures of situation awareness: a comparison of SAGAT and SPAM," *Human Factors*, vol. 63, no. 1, pp. 124–150, 2021.
22. A. Doula, L. Schmidt, M. Mühlhäuser, and A. Sanchez Guinea, "'Can you handle the truth?': investigating the effects of AR-based visualization of the uncertainty of deep learning models on users of autonomous vehicles," in *Proc. IEEE ISMAR*, 2023, doi: 10.1109/ISMAR59233.2023.00040.
23. T. Scargill, Y. Chen, T. Hu, and M. Gorlatova, "SiTAR: situated trajectory analysis for in-the-wild pose error estimation," in *Proc. IEEE ISMAR*, 2023, pp. 283–292.
24. C. Toft, W. Maddern, A. Torii, L. Hammarstrand, E. Stenborg, D. Safari, M. Okutomi, M. Pollefeys, J. Sivic, T. Pajdla, F. Kahl, and T. Sattler, "Long-term visual localization revisited," *IEEE Trans. Pattern Analysis and Machine Intelligence*, vol. 44, no. 4, pp. 2074–2088, 2022.
25. P.-E. Sarlin, M. Dusmanu, J. L. Schönberger, P. Speciale, L. Gruber, V. Larsson, O. Miksik, and M. Pollefeys, "LaMAR: benchmarking localization and mapping for augmented reality," in *Proc. ECCV*, LNCS vol. 13667, 2022, pp. 686–704.
26. P.-E. Sarlin, D. DeTone, T.-Y. Yang, A. Avetisyan, J. Straub, T. Malisiewicz, S. Rota Bulò, R. Newcombe, P. Kontschieder, and V. Balntas, "OrienterNet: visual localization in 2D public maps with neural matching," in *Proc. IEEE/CVF CVPR*, 2023, pp. 21632–21642.
27. E. Arnold, J. Wynn, S. Vicente, G. Garcia-Hernando, Á. Monszpart, V. Prisacariu, D. Turmukhambetov, and E. Brachmann, "Map-free visual relocalization: metric pose relative to a single image," in *Proc. ECCV*, 2022, doi: 10.1007/978-3-031-19769-7_40.
28. E. Brachmann, T. Cavallari, and V. A. Prisacariu, "Accelerated coordinate encoding: learning to relocalize in minutes using RGB and poses," in *Proc. IEEE/CVF CVPR*, 2023, pp. 5044–5053.
29. S. Cao, X. Lu, and S. Shen, "GVINS: tightly coupled GNSS–visual–inertial fusion for smooth and consistent state estimation," *IEEE Trans. Robotics*, vol. 38, no. 4, pp. 2004–2021, 2022.
30. M. Dusmanu, J. L. Schönberger, S. N. Sinha, and M. Pollefeys, "Privacy-preserving image features via adversarial affine subspace embeddings," in *Proc. IEEE/CVF CVPR*, 2021, pp. 14267–14277.
31. T. Kosch, J. Karolus, J. Zagermann, H. Reiterer, A. Schmidt, and P. W. Woźniak, "A survey on measuring cognitive workload in human-computer interaction," *ACM Computing Surveys*, vol. 55, no. 13s, art. 283, 2023.

*© 2026 AIDotLix. Waylix and the Waylix Hazard Fusion Engine are products of AIDotLix.*

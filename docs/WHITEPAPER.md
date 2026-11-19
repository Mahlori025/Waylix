# Every Road Remembers

### Can Crowd-Sensed Road Hazards Ground Outdoor Augmented Reality? Four Research Questions Answered with Waylix

**AIDotLix White Paper · WP-2026-03 · Version 1.0 · November 2026**
Author: Mahlori Lloyd Chauke (AIDotLix), Johannesburg, South Africa

---

## Abstract

Augmented reality (AR) navigation has been studied for nearly three decades, and the literature is clear about how to draw a warning in the user's view. It says much less about where trustworthy warnings come from in the first place. In this paper I ask whether crowd-sensed road-hazard reports, the potholes, sinkholes and accident zones that ordinary drivers and pedestrians report, can become AR-grade content. I frame four research questions on content, registration, presentation and transfer to drones. I answer them using **Waylix**, an AIDotLix navigation app, and its **Hazard Fusion Engine**, which I designed and built following a design-science approach. The engine fuses reports into hazards that carry both an existence probability and a positional uncertainty. Simulations on the real engine show that a hazard's fused position error falls as 6/√*n* metres with *n* independent reports, from 6.1 m to 1.9 m between one and ten reports. An angular registration model built on those figures shows that GNSS-only phones misplace a pothole by 10–22° at walking distances, so they are adequate for zones and driving cues but not for pinning point hazards. A Visual Positioning System (VPS) on the viewer's device alone is not enough either. Point-accurate AR only becomes possible when the reports themselves are VPS-anchored at capture time, which brings the error at 35 m down to 1.3°, smaller than the 1.6° a one-metre pothole occupies in view. I translate these findings into presentation rules grounded in situation-awareness theory and set out a user study to test them.

**Keywords:** augmented reality, registration error, crowdsensing, volunteered geographic information, situation awareness, visual positioning, road safety.

---

## 1. Introduction

I am an electrical engineer in Johannesburg, and like everyone who drives or walks here, I navigate around potholes, missing manhole covers and dark intersections every day. Most of these hazards are known to somebody, but that knowledge rarely reaches the next person on the road in time. When I started work on Waylix, I first saw it as a reporting and navigation problem. The longer I worked on it, the more it looked like an augmented reality problem.

Azuma defined AR as a system that combines real and virtual content, is interactive in real time, and is registered in three dimensions [1]. Milgram and Kishino placed it on a continuum between the real and the virtual environment [2]. Feiner and colleagues took AR outdoors with the Touring Machine, a wearable system that overlaid information on the campus around the user [3]. Navigation followed naturally. Narzt et al. proposed the car itself as the AR display, painting the route onto the road ahead [4]. Kim and Dey showed in a simulator that an AR windshield display reduced navigation errors and distraction for elder drivers [5]. Tönnis et al. found that AR cues placed in the driver's own frame of reference could direct attention toward a source of danger [6].

These studies share an assumption I want to question. They assume the system already knows where the danger is, either from the vehicle's own sensors or from a curated map. On the roads I drive, no such map exists. Meanwhile, a separate body of work has shown that ordinary people and their phones can sense road conditions. Eriksson et al.'s Pothole Patrol detected road anomalies from vehicle-mounted accelerometers [7], and Mednis et al. did the same with Android smartphones [8]. Goodchild described citizens as sensors producing volunteered geographic information [9], and OpenStreetMap showed that such contributions can build a world map [10]. What I could not find was work connecting these two traditions: **crowd-sensed hazard data characterised as content for AR**. That is the gap this paper addresses.

## 2. Research questions

I state four questions:

1. **RQ1 (content).** Can noisy, unverified, duplicated crowd reports be turned into AR-grade content, meaning hazards with a quantified probability of existing and a quantified positional uncertainty?
2. **RQ2 (registration).** What device positioning accuracy is needed to anchor such hazards in a handheld AR view? Is GNSS sufficient, or is a Visual Positioning System required?
3. **RQ3 (presentation).** How should uncertain, time-decaying hazards be presented so that they improve situation awareness rather than overload it?
4. **RQ4 (transfer).** Can the same pipeline serve aerial platforms (drones), both as sensors and as AR users?

## 3. Method

I followed design science research as described by Hevner et al. [11]: build an artefact that addresses a relevant problem, then evaluate it rigorously. The artefact is Waylix, an Android and iOS navigation app on OpenStreetMap data [10] with drive and walk routing over OSRM [15], together with its Hazard Fusion Engine. In this paper I evaluate it in three ways. First, analytically, by deriving the registration error a user would see. Second, by simulation: every figure in Section 5 comes from running the production engine code (the study script is `packages/engine/bench/ar-study.ts` in the repository), not from a separate model. Third, through a planned user study, which I lay out in Section 6. I am explicit throughout about which answers are established by the first two methods and which await the third.

## 4. The artefact in brief

Every input, whether a tap, an accelerometer jolt or a drone detection, is reduced to one observation schema: type, position, accuracy, time, reporter, platform and source. Observations of the same type within a type-specific merge radius are fused into one hazard.

For existence, I borrowed the log-odds formulation that Moravec and Elfes introduced for occupancy-grid mapping in robotics [12]. Evidence adds in log-odds space, and a sceptical prior keeps a single report from being taken as fact:

$$
\text{logit}\,P(h) = \beta_0 + \sum_{e} s_e\, w_e\, T(\rho_e)\, 2^{-\Delta t_e/\tau}
$$

Each reporter's latest statement *e* counts once, which resists spam. Its sign *s* is positive for a report or confirmation and negative for a dismissal. Its weight *w* depends on the source (manual 1.2, accelerometer 0.45, drone camera 1.0). The evidence decays with a half-life *τ* specific to the hazard type: an accident fades in hours, a pothole persists for weeks. Reporter trust *T* comes from a Beta reputation posterior in the manner of Jøsang and Ismail [13].

Position is fused by inverse-variance weighting, the static special case of Kalman's estimator [14]. The same principle blends GNSS and, in future, VPS fixes on the device. A hazard therefore carries two numbers AR can use: *P(h)* and a positional spread σ. The engine runs identically on the phone (offline) and on the server, and 43 automated tests cover its behaviour.

## 5. Findings

### 5.1 RQ1: crowd reports can become AR-grade content

I simulated 2,000 trials per condition. Each trial fused *n* independent pothole reports, each with 6 m RMS horizontal error, a modelling assumption consistent with the metre-level errors Zandbergen and Barbeau measured for phone A-GPS [16].

| Reports *n* | Fused RMS error | 95th percentile | Theory 6/√*n* |
|---|---|---|---|
| 1 | 6.05 m | 10.63 m | 6.00 m |
| 3 | 3.45 m | 5.92 m | 3.46 m |
| 10 | 1.90 m | 3.27 m | 1.90 m |
| 20 | 1.41 m | 2.27 m | 1.34 m |

The engine matches the theoretical 1/√*n* behaviour of independent averaging, so each extra reporter genuinely sharpens the location. With default settings, one report is shown as a candidate (*P* ≈ 0.43), two reporters make it active, and three verify it (*P* > 0.85). **My answer to RQ1 is yes.** Fusion turns crowd reports into content with an explicit existence probability and positional σ. These are exactly the two quantities an AR renderer needs to decide *whether* to show a hazard and *how precisely* to place it.

### 5.2 RQ2: GNSS anchors zones; VPS is needed at both ends to pin points

An overlay drawn at distance *d* is misplaced by an angle θ = atan(*e* / *d*), where *e* combines the device's position error with the hazard's own error. I converted θ into on-screen pixels for a typical phone camera (63° horizontal field of view, 1,080 px wide). For the hazard, I used a three-reporter pothole (σ = 3.45 m, from Table 1).

| Distance | Phone GNSS (σ = 5 m) | VPS on viewer only (σ = 0.5 m) | VPS viewer + VPS-anchored reports |
|---|---|---|---|
| 15 m | 22.0° (378 px) | 13.1° (224 px) | 2.9° (50 px) |
| 35 m | 9.8° (169 px) | 5.7° (97 px) | 1.3° (21 px) |
| 60 m | 5.8° (99 px) | 3.3° (57 px) | 0.7° (13 px) |
| 150 m | 2.3° (40 px) | 1.3° (23 px) | — |

A one-metre pothole subtends only 3.8° at 15 m and 1.6° at 35 m. Three conclusions follow.

- **GNSS is good enough for zones and for driving-distance cues.** A 400 m high-accident zone is mis-registered by only 1.5% of its radius at 150 m. At driving look-ahead distances (the engine warns about 418 m ahead at 60 km/h), the error is a small fraction of the scene.
- **GNSS cannot pin a point hazard at walking distance.** At 15–35 m the error is several times larger than the pothole itself. A world-locked pin would point at the wrong patch of tar.
- **VPS on the viewer's device alone does not solve this,** which surprised me. Once the device is accurate, the hazard's crowd-sourced position becomes the dominant error. Point-accurate AR only appears when reports are *also* captured with VPS. With three VPS-anchored reports (σ ≈ 0.58 m), misregistration at 35 m drops to 1.3°, inside the pothole's own outline.

Visual localisation makes this plausible. Structure-based methods register a photo against a 3D model at city scale [17], learned regressors such as PoseNet estimate camera pose from a single image [18], ORB-SLAM tracks a camera in real time [19], and model-based tracking has kept outdoor AR registered in urban scenes [20]. **My answer to RQ2:** GNSS is sufficient for zone-level and distance-banded AR; pinned point-hazard AR requires VPS both when the hazard is reported and when it is viewed. That changes the Waylix roadmap. VPS has to enter the reporting flow, not just the viewing flow.

### 5.3 RQ3: present uncertainty, don't hide it

Endsley's model describes situation awareness at three levels: perceiving elements, comprehending them and projecting their future state [21]. A hazard warning has to support all three without stealing attention from the road. Wickens's multiple-resource theory suggests that splitting information across sensory channels, such as audio plus a glanceable visual, limits interference [22]. The AR perception literature warns about clutter, depth ambiguity and outdoor legibility [23]. Livingston et al. showed that showing too many occluded layers overwhelms users unless drawing style and opacity are carefully controlled [24]. Gabbard et al. caution that on-road AR competes directly with the driving task [25]. From these and my RQ2 results, I derive four rules, which Waylix's map layer already partly implements:

1. **Encode confidence as opacity.** Candidates are drawn faded, verified hazards solid. This keeps Level-1 perception honest about what is still uncertain.
2. **Encode positional σ as footprint, not a pin.** Draw a ground disc whose radius is the fused σ, so the overlay never claims more precision than the data has.
3. **Switch representation on the registration test.** When θ exceeds the hazard's angular size, show a distance-and-direction cue ("pothole ahead, 35 m") instead of a world-locked marker. Switch to a pinned overlay only once θ falls below the angular size, which, per RQ2, means VPS at both ends.
4. **Lead with audio for drivers; reserve handheld AR for pedestrians.** The engine's time-based look-ahead already sets the moment of the warning: about 60 m for a walker and about 418 m at 60 km/h. That supports Level-3 projection without requiring the driver to look at a phone.

**My answer to RQ3** is these four rules. They are grounded in established theory and my measured registration limits, but they remain hypotheses until the study in Section 6 tests them.

### 5.4 RQ4: one pipeline transfers to drones

A drone camera is treated as another sensor. Detections are projected from pixel coordinates to the ground using a pinhole camera model with known intrinsic parameters, following classical calibration practice [26], and the drone's pose. The adapter attaches an error estimate that grows with slant range. Aerial hazards such as cables and cranes are stored in an *air* domain with altitude bands, so hazards at different heights are not merged. In the engine's tests, a pothole detected by a drone at 60 m altitude fuses into the same hazard a driver reported. **My answer to RQ4 is a qualified yes.** The data path transfers without modification, and the same registration analysis applies to a drone operator's first-person view. Flat-ground projection and flight validation are still open.

## 6. Planned evaluation

To test the RQ3 rules, I will run a within-subjects study with pedestrians in Johannesburg, comparing a 2D map with audio alerts against an AR view that follows the four rules. Driving conditions will be simulated only, for safety. I will measure hazard identification time and accuracy; situation awareness with the SAGAT freeze-probe technique [27]; workload with NASA-TLX [28]; and usability with the System Usability Scale, interpreted against Bangor et al.'s benchmarks [29]. My hypotheses are that the AR condition improves identification time without raising workload, and that the switch from cue to pin (rule 3) prevents the false-precision errors a naive pin would cause.

## 7. Limitations

My registration figures rest on simulation, and real GNSS error is neither Gaussian nor independent between nearby reporters: multipath in urban canyons correlates errors [16], which would slow the 1/√*n* gain. The source weights and decay half-lives are engineering priors that still need field calibration. Accelerometer evidence cannot yet tell a pothole from a speed bump. And the AR rendering layer described in Section 5.3 is designed, not yet built. Waylix today delivers the fusion engine, the hazard map, offline navigation and audio alerts on which that layer will sit.

## 8. Conclusion

I set out to find whether the reports of ordinary road users can carry the weight of augmented reality. The answer is that they can, provided we treat them as evidence rather than fact. Fusion gives every hazard a probability and a spread. Registration analysis tells us which hazards GNSS can anchor and which need VPS, at capture as well as at viewing. Established human-factors theory tells us how to show the uncertainty honestly. Every road remembers. With Waylix, I want the next person on that road to see what it remembers.

---

### References

1. R. T. Azuma, "A survey of augmented reality," *Presence: Teleoperators and Virtual Environments*, vol. 6, no. 4, pp. 355–385, 1997.
2. P. Milgram and F. Kishino, "A taxonomy of mixed reality visual displays," *IEICE Trans. Information and Systems*, vol. E77-D, no. 12, pp. 1321–1329, 1994.
3. S. Feiner, B. MacIntyre, T. Höllerer, and A. Webster, "A touring machine: prototyping 3D mobile augmented reality systems for exploring the urban environment," in *Proc. IEEE Int. Symp. Wearable Computers (ISWC)*, 1997, pp. 74–81.
4. W. Narzt, G. Pomberger, A. Ferscha, D. Kolb, R. Müller, J. Wieghardt, H. Hörtner, and C. Lindinger, "Augmented reality navigation systems," *Universal Access in the Information Society*, vol. 4, no. 3, pp. 177–187, 2006.
5. S. Kim and A. K. Dey, "Simulated augmented reality windshield display as a cognitive mapping aid for elder driver navigation," in *Proc. ACM CHI*, 2009, pp. 133–142.
6. M. Tönnis, C. Sandor, C. Lange, and H. Bubb, "Experimental evaluation of an augmented reality visualization for directing a car driver's attention," in *Proc. IEEE/ACM ISMAR*, 2005, pp. 56–59.
7. J. Eriksson, L. Girod, B. Hull, R. Newton, S. Madden, and H. Balakrishnan, "The Pothole Patrol: using a mobile sensor network for road surface monitoring," in *Proc. ACM MobiSys*, 2008, pp. 29–39.
8. A. Mednis, G. Strazdins, R. Zviedris, G. Kanonirs, and L. Selavo, "Real time pothole detection using Android smartphones with accelerometers," in *Proc. IEEE DCOSS*, 2011, pp. 1–6.
9. M. F. Goodchild, "Citizens as sensors: the world of volunteered geography," *GeoJournal*, vol. 69, no. 4, pp. 211–221, 2007.
10. M. Haklay and P. Weber, "OpenStreetMap: user-generated street maps," *IEEE Pervasive Computing*, vol. 7, no. 4, pp. 12–18, 2008.
11. A. R. Hevner, S. T. March, J. Park, and S. Ram, "Design science in information systems research," *MIS Quarterly*, vol. 28, no. 1, pp. 75–105, 2004.
12. H. Moravec and A. Elfes, "High resolution maps from wide angle sonar," in *Proc. IEEE Int. Conf. Robotics and Automation (ICRA)*, 1985, pp. 116–121.
13. A. Jøsang and R. Ismail, "The beta reputation system," in *Proc. 15th Bled Electronic Commerce Conf.*, 2002.
14. R. E. Kalman, "A new approach to linear filtering and prediction problems," *Trans. ASME, J. Basic Engineering*, vol. 82, no. 1, pp. 35–45, 1960.
15. D. Luxen and C. Vetter, "Real-time routing with OpenStreetMap data," in *Proc. ACM SIGSPATIAL GIS*, 2011, pp. 513–516.
16. P. A. Zandbergen and S. J. Barbeau, "Positional accuracy of assisted GPS data from high-sensitivity GPS-enabled mobile phones," *J. Navigation*, vol. 64, no. 3, pp. 381–399, 2011.
17. T. Sattler, B. Leibe, and L. Kobbelt, "Efficient & effective prioritized matching for large-scale image-based localization," *IEEE Trans. Pattern Analysis and Machine Intelligence*, vol. 39, no. 9, pp. 1744–1756, 2017.
18. A. Kendall, M. Grimes, and R. Cipolla, "PoseNet: a convolutional network for real-time 6-DOF camera relocalization," in *Proc. IEEE ICCV*, 2015, pp. 2938–2946.
19. R. Mur-Artal, J. M. M. Montiel, and J. D. Tardós, "ORB-SLAM: a versatile and accurate monocular SLAM system," *IEEE Trans. Robotics*, vol. 31, no. 5, pp. 1147–1163, 2015.
20. G. Reitmayr and T. W. Drummond, "Going out: robust model-based tracking for outdoor augmented reality," in *Proc. IEEE/ACM ISMAR*, 2006, pp. 109–118.
21. M. R. Endsley, "Toward a theory of situation awareness in dynamic systems," *Human Factors*, vol. 37, no. 1, pp. 32–64, 1995.
22. C. D. Wickens, "Multiple resources and performance prediction," *Theoretical Issues in Ergonomics Science*, vol. 3, no. 2, pp. 159–177, 2002.
23. E. Kruijff, J. E. Swan II, and S. Feiner, "Perceptual issues in augmented reality revisited," in *Proc. IEEE ISMAR*, 2010, pp. 3–12.
24. M. A. Livingston, J. E. Swan II, J. L. Gabbard, T. H. Höllerer, D. Hix, S. J. Julier, Y. Baillot, and D. Brown, "Resolving multiple occluded layers in augmented reality," in *Proc. IEEE/ACM ISMAR*, 2003, pp. 56–65.
25. J. L. Gabbard, G. M. Fitch, and H. Kim, "Behind the glass: driver challenges and opportunities for AR automotive applications," *Proc. IEEE*, vol. 102, no. 2, pp. 124–136, 2014.
26. R. Y. Tsai, "A versatile camera calibration technique for high-accuracy 3D machine vision metrology using off-the-shelf TV cameras and lenses," *IEEE J. Robotics and Automation*, vol. RA-3, no. 4, pp. 323–344, 1987.
27. M. R. Endsley, "Measurement of situation awareness in dynamic systems," *Human Factors*, vol. 37, no. 1, pp. 65–84, 1995.
28. S. G. Hart, "NASA-Task Load Index (NASA-TLX); 20 years later," in *Proc. Human Factors and Ergonomics Society Annual Meeting*, vol. 50, no. 9, 2006, pp. 904–908.
29. A. Bangor, P. T. Kortum, and J. T. Miller, "An empirical evaluation of the System Usability Scale," *Int. J. Human–Computer Interaction*, vol. 24, no. 6, pp. 574–594, 2008.

*© 2026 AIDotLix. Waylix and the Waylix Hazard Fusion Engine are products of AIDotLix.*

inf_squad_rigid_592ebbb19.glb -- a byte copy of art/meshes/inf_squad.glb at commit
592ebbb193e6aa64e85befffd024b2fd8f16f023 ("art: Rifle Squad hands on the weapon (GH-826/GH-746 step 2) (#924)"),
the last commit on main to change that file before the GH-746 Meshy pilot. Check it with
`git show 592ebbb19:art/meshes/inf_squad.glb | cmp - tools/src/fixtures/inf_squad_rigid_592ebbb19.glb`.

It is the RIGID Rifle Squad, the only figure the procedural hands pass and the R1 forearm tube ever built. The pilot
replaced it with a skinned Meshy figure (`rl_hands.source: "meshy"`), so the gates whose SUBJECT is that pass's output
(mesh_forearm, the mesh_hands bands, launcher_arms' rigid rows, grip inputs 5 and 6) have no shipped subject; they read
this frozen copy so they keep an input and their constructed failing inputs still go red. A byte copy, not new art: its
.blend source is the one in history at that commit. CI's `gates` job checks out shallow, so `git show <rev>:...` is not
available to a test. Accepted by the lead on 9 Nov 2026 (GH-746).

demo_squad_rigid_422df13dd.glb -- a byte copy of art/meshes/demo_squad.glb at commit
422df13dd44fed99f34f8d6a09ed66b812b5c16e ("art: the Demolition squad's kit, real gear fitted to the figure (GH-826) (#903)"),
the last commit on main to change that file before infantry upgrade unit 1 (GH-826, 12 Nov 2026) replaced the team
with a skinned Meshy body. Check it with
`git show 422df13dd:art/meshes/demo_squad.glb | cmp - tools/src/fixtures/demo_squad_rigid_422df13dd.glb`.

It is the RIGID Combat Engineers: two cut Meshy figures with open claws, `demo_a` unarmed, a kit carbine on `demo_b`.
`mesh_work.test.ts` runs `motion/work.ts` on it to hold the free-armed `work` (the forearm pump) every rigid team still
gets, now that the shipped team works with its fists fused to its carbine. Since 13 Nov it is also the constructed
failing input of the gates whose red case was this team's own claws: `mesh_hands.test.ts` (a Meshy claw is red),
`mesh_grip.test.ts` (input 1: the firing hand 0.1 m from the grip), `mesh_armed.test.ts` (the unarmed engineer) and
`mesh_fragments.test.ts` (the "third hand at the hip", 358 cm2 a man). A byte copy, not new art: its .blend source
is the one in history at that commit. The frozen rigid GLB is number 8 of the lead's approval of 12 Nov 2026 (GH-826).

yahalom_squad_rigid_7dae29e2f.glb -- a byte copy of art/meshes/yahalom_squad.glb at commit
7dae29e2f68bfcf3526ea3ae4bb4770127b07b1f ("polish: readable suppression and damage states (pass C2/C4) (#445)"),
the last commit to change that file before infantry upgrade unit "Yahalom" (GH-826, 17 Nov 2026) replaced the team
with the Combat Engineers' skinned Meshy body. Check it with
`git show 7dae29e2f:art/meshes/yahalom_squad.glb | cmp - tools/src/fixtures/yahalom_squad_rigid_7dae29e2f.glb`.

It is the RIGID Yahalom Engineers (B7): three cut bodies of one 2,000-target remesh with open black claws, `yah_a` and
his kneeling twin `yah_ak` unarmed behind a 1.45 m mast, a kit carbine on `yah_b`, a 12-triangle box pack on each.
It is the constructed failing input of the gates whose red case was this team's own figure: `mesh_armed.test.ts` (the
unarmed bearer and his twin), `mesh_fragments.test.ts` (three builds blind to the tone test), and
`launcher_clearance.test.ts` (the box packs the same instrument still reads). A byte copy, not new art: its .blend
source is the one in history at that commit. The frozen rigid GLB is decision 8 of the lead's approval of 15 Nov 2026
(GH-826).

release-notes-599d38012.json -- a byte copy of data/release-notes/next.json at commit 599d38012 (main's merge of dev
7a5434987, PR 1634), the promotion cut as v0.134.1 because its 87 commits carried no `feat:` type. Check it with
`git show 599d38012:data/release-notes/next.json | cmp - tools/src/fixtures/release-notes-599d38012.json`.

Its sections are 0 units, 16 rules and 2 fixes. `decide_version.test.ts` feeds it to a scratch promotion, where the
release rule of 19 Nov 2026 (the notes' units or rules cut a minor) must answer 0.135.0. Real-shaped notes, not new
content: it is never read as release notes (it is outside data/release-notes/).

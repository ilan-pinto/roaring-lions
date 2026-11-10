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

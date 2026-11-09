inf_squad_rigid_592ebbb19.glb -- origin/main's art/meshes/inf_squad.glb as of commit 592ebbb19 (the last before the
GH-746 Meshy pilot): the RIGID Rifle Squad, the only figure the procedural hands pass and the R1 forearm tube ever
built. Since the pilot replaced it with a skinned Meshy figure (`rl_hands.source: "meshy"`), the gates whose SUBJECT is
that pass's output (mesh_forearm, the mesh_hands bands) have no shipped subject; they read this frozen copy so they keep
an input and their constructed failing inputs still go red. A byte copy, not new art: its .blend source is the one in
history at that commit. CI's `gates` job checks out shallow, so `git show <rev>:...` is not available to a test.

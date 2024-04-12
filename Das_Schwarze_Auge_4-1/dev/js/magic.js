/* magic begin */
function modifySpellAttributesByRepresentation(spellRepStat, charData, spellStats) {
	/* deal with representation special rules:
		if representation is elven and KL < IN, replace first KL with IN, unless that would make all rolls IN 
		if rep is achaz and two rolls are for KL or two are for IN, replace one of them with max(KL, IN)
		if rep is kophtan, and KL < CH, replace first KL with CH, unless that would make all rolls CH
	*/
	const func = "Attribute modification by spell representation";
	let spellRep = "";
	let modified = false;
	if (charData[spellRepStat] === 0 || charData[spellRepStat] === "") {
		spellRep = charData["z_erstrepraesentation"];
	} else {
		spellRep = charData[spellRepStat];
	}
	debugLog(func, spellRep, charData, spellStats);
	switch (spellRep) {
		case "Elf":
			debugLog(func, "Adapting for elven rep");
			if (charData['KL'] >= charData['IN']) {
				break;
			}
			for (let i = 0; i < 3; i++) {
				if (spellStats[i] === "KL" && (spellStats[(i+1) % 3] !== "IN" || spellStats[(i + 2) % 3] !== "IN")) {
					spellStats[i] = "IN";
					modified = true;
					break;
				}
			}
			break;
		case "Ach":
			debugLog(func, "Adapting for achaz rep");
			// Stat occurring at least twice
			let multiStat = "";
			// Stat occuring once or zero times, the stat that shall be checked for replacing one instance of the multiStat
			let otherStat = "";

			const relevantStats = [ "KL", "IN" ];
			let spellStatFreq = { "KL": 0, "IN": 0 };
			// Analyse spell's stats looking for our relevant ones
			for (let spellStat of spellStats) {
				if (relevantStats.includes(spellStat)) {
					spellStatFreq[spellStat] += 1;
				}
			}

			// Determine whether spell has potentially beneficial stat situation
			for (let stat of relevantStats){
				if (spellStatFreq[stat] >= 2) {
					multiStat = stat;
				} else {
					otherStat = stat;
				}
			}

			// No stat occurring at least twice? No replacement possible, so break
			if (multiStat === "") break;

			if (charData[multiStat] > charData[otherStat]) {
				for (let i in spellStats) {
					if (spellStats[i] === multiStat) {
						spellStats[i] = otherStat;
						modified = true;
						break;
					}
				}
			}
			break;
		case "Kop":
			debugLog(func, "Adapting for kophtan rep");
			if (charData['KL'] >= charData['CH']) {
				break;
			}
			for (let i = 0; i < 3; i++) {
				if (spellStats[i] === "KL" && (spellStats[(i+1) % 3] !== "CH" || spellStats[(i + 2) % 3] !== "CH")) {
					spellStats[i] = "CH";
					modified = true;
					break;
				}
			}
			break;
		default:
			break;
	}
	return modified;
}

on(spells.map(spell => "clicked:" + spell + "-action").join(" "), (info) => {
	var func = "Action Listener for Spell Roll Buttons";
	var trigger = info["triggerName"].replace(/clicked:([^-]+)-action/, '$1');
	var nameInternal = spellsData[trigger]["internal"];
	var nameUI = spellsData[trigger]["ui"];
	//Copy array, or we get a reference and modify the database
	var stats = [...spellsData[trigger]["stats"]];
	var spellRepAttr = trigger + "_rep";
	debugLog(func, trigger, spellsData[trigger]);
	safeGetAttrs(["z_erstrepraesentation", spellRepAttr, "v_festematrix", "n_spruchhemmung", "KL", "IN", "CH"], function (v) {
		let repModified = modifySpellAttributesByRepresentation(spellRepAttr, v, stats);
		// Build Roll Macro
		var rollMacro = "";

		rollMacro +=
			"@{gm_roll_opt} " +
			"&{template:zauber} " +
			"{{name=" + nameUI + "}} " +
			"{{wert=[[@{ZfW_" + nameInternal + "}d1cs0cf2]]}} " +
			"{{mod=[[?{Erleichterung (−) oder Erschwernis (+)|0}d1cs0cf2]]}} " +
			"{{stats=[[ " +
				"[Eigenschaft 1:] [[@{" + stats[0] + "}]]d1cs0cf2 + " +
				"[Eigenschaft 2:] [[@{" + stats[1] + "}]]d1cs0cf2 + " +
				"[Eigenschaft 3:] [[@{" + stats[2] + "}]]d1cs0cf2" +
				"]]}} " +
			"{{roll=[[3d20cs<@{cs_zauber}cf>@{cf_zauber}]]}} " +
			"{{result=[[0]]}} " +
			"{{criticality=[[0]]}} " +
			"{{critThresholds=[[[[@{cs_zauber}]]d1cs0cf2 + [[@{cf_zauber}]]d1cs0cf2]]}} " + 
			"{{repmod=" + (repModified ? "Die verwendeten Attribute wurden durch die Repräsentation modifiziert" : "") + "}} ";
		debugLog(func, rollMacro);

		// Execute Roll
		startRoll(rollMacro).then((results) => {
			console.log("test: info:", info, "results:", results);
			var rollID = results.rollId;
			results = results.results;
			var TaW = results.wert.result;
			var mod = results.mod.result;
			var stats = [
				results.stats.rolls[0].dice,
				results.stats.rolls[1].dice,
				results.stats.rolls[2].dice
			];
			var rolls = results.roll.rolls[0].results;
			var success = results.critThresholds.rolls[0].dice;
			var failure = results.critThresholds.rolls[1].dice;
			/* Result
			-1	Failure (due to Firm Matrix)
			0	Failure
			1	Success
			2	Success (due to Firm Matrix)
			*/
			var result = 0;
			/* Criticality
			-4	Two or more dice same result (not 1, not 20); via Spell Stalling (Spruchhemmung)
			-3	Triple 20
			-2	Double 20
			0	no double 1/20
			+2	Double 1
			+3	Triple 1
			*/
			var criticality = 0;


			/*
				Doppel/Dreifach-1/20-Berechnung
				Vor der TaP*-Berechnung, da diese damit gegebenenfalls hinfällig wird
			*/
			/*
			Variable, um festhalten zu können, dass ein
				* normal misslungenes Ergebnis ohne Feste Matrix automatisch misslungen wäre und
				* normal gelungenes Ergebnis ohne Feste Matrix automatisch misslungen wäre
			*/
			var festeMatrixSave = false;
			{
				let successes = 0;
				let failures = 0;
				let festeMatrix = v["v_festematrix"] === "0" ? false : true;
				let spruchhemmung = v["n_spruchhemmung"] === "0" ? false : true;

				for (roll of rolls)
				{
					if (roll <= success)
					{
						successes += 1;
					} else if (roll >= failure) {
						failures += 1;
					}
					if (successes >= 2)
					{
						criticality = successes;
					} else if (failures >= 2) {
						criticality = -failures;
					}
				}
				// feste Matrix
				if (festeMatrix && criticality === -2)
				{
					criticality = -1;
					festeMatrixSave = true;

					for (roll of rolls)
					{
						if (
							(roll > success) &&
							(roll < failure) &&
							(
								roll === 18 || roll === 19
							)
						)
						{
							criticality -= 1;
							festeMatrixSave = false;
						}
					}
				}
				// Spruchhemmung, soll nur auslösen, wenn eh nicht Doppel/Dreifach-1/20
				if (
					spruchhemmung &&
					criticality > -2 &&
					criticality < 2 &&
					(
						(rolls[0] === rolls[1]) ||
						(rolls[1] === rolls[2]) ||
						(rolls[2] === rolls[0])
					)
				)
				{
					criticality = -4;
				}
			}

			/*
				TaP*-Berechnung
			*/
			var effRolls = rolls;
			var effTaW = TaW - mod;
			var TaPstar = effTaW;

			// Negativer TaW: |effTaW| zu Teilwürfen addieren
			if (criticality >= 2)
			{
				TaPstar = TaW;
				result = 1;
			} else {
				if (effTaW < 0)
				{
					for (roll in rolls)
					{
						effRolls[roll] = rolls[roll] + Math.abs(effTaW);
					}
					TaPstar = 0;
				}

				// TaP-Verbrauch für jeden Wurf
				for (roll in effRolls)
				{
					TaPstar -= Math.max(0, effRolls[roll] - stats[roll]);
				}

				// Max. TaP* = TaW, mindestens aber 0
				TaPstar = Math.min(Math.max(TaW, 0), TaPstar);

				// Ergebnis an Doppel/Dreifach-20 anpassen
				if (Math.abs(criticality) <= 1)
				{
					result = TaPstar < 0 ? 0 : 1;
					if (festeMatrixSave && result === 0)
					{
						result = -1;
					} else if (festeMatrixSave && result === 1)
					{
						result = 2;
					}
				} else if (criticality <= -2) {
					result = 0;
				}
			}

			finishRoll(
				rollID,
				{
					roll: TaPstar,
					result: result,
					criticality: criticality,
					stats: stats.toString().replaceAll(",", "/")
				}
			);
		});
	});
});
/* magic end */

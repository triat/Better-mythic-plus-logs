// French copy of docs.ts, served by GET /api/docs?lang=fr. Same structure entry for entry (test/evaluation/docs.test.ts
// checks the parity); player's franglais, "tu"; WoW terms stay English (kick, key, timed/depleted, parse, wipe, run,
// spec, cooldown, defensive…). No config number in the prose: thresholds and weights are printed from the config.
import type { EvaluationDocs } from "./docs.ts";

export const EVALUATION_DOCS_FR: EvaluationDocs = {
  sources: [
    { title: "Classements Warcraft Logs", text: "Le meilleur run du perso par donjon cette saison sur la métrique choisie (DPS, ou HPS pour les heals), avec le parse %, le niveau de key, la date et le report. C'est la liste qu'affiche le tableau des runs ; l'évaluation utilise ces runs plus le meilleur run au niveau de key le plus proche sous la cible qui en a un. Une région par recherche (EU, US, KR, TW) — le chip dans le champ de recherche mémorise ton dernier choix ; un lien Raider.IO collé apporte sa propre région.", freshness: "Récupéré à chaque recherche. Une recherche reste dans ton historique jusqu'à ce que tu la rafraîchisses ; sur une instance partagée, une recherche du même perso faite par un autre membre il y a moins de 6 heures est réutilisée au lieu d'être refaite (l'onglet indique « en cache »)." },
    { title: "Le log de chaque run", text: "Pour chaque run affiché, les événements du combat lui-même : morts (ce qui a tué le joueur, qui d'autre est mort et quand), dégâts subis, dégâts des mécaniques évitables listées pour la saison, kicks, dispels, potions et healthstones — pour le joueur et pour les quatre autres du groupe.", freshness: "Récupéré une fois par run (environ 10 points WCL) et mis en cache pour toujours : un run ne change jamais après coup." },
    { title: "Raider.IO", text: "Item level, score de la saison en cours et de la précédente par rôle, et les 10 derniers runs avec timed/depleted.", freshness: "Récupéré à la recherche et réutilisé pendant une heure (Rafraîchir le récupère à nouveau) ; gratuit, sans clé." },
  ],
  runsUsed: "Les « runs affichés » sont le meilleur run par donjon cette saison (un par donjon) plus, s'il n'en fait pas déjà partie, le meilleur run au niveau de key le plus proche sous la cible qui en a un. Un run compte pour l'évaluation une fois son log récupéré (« enrichi ») ; le nombre de runs enrichis est ce que regardent la confiance et la règle du minimum de runs.",
  peers: "Les « pairs » sont les autres joueurs du même run — jamais une moyenne globale. La comparaison est (toi − médiane des pairs) / médiane des pairs, en %, donc +20 % veut dire un cinquième de plus que le joueur typique de ce groupe précis et de cette key précise. Quels joueurs comptent comme pairs dépend du signal : tout le monde pour les dégâts évitables, les DPS seulement pour les dégâts subis (un tank est censé en prendre plus), DPS et tanks pour les kicks (les heals kickent rarement).",
  verdict: {
    summary: "Le verdict est une lecture par règles de six axes. Chaque axe est noté de 0 à 100 à partir de ses sous-signaux ; le score global est une moyenne pondérée des axes ; le verdict est le score global face à deux seuils.",
    role: "Le rôle (DPS, heal, tank) est celui que le joueur avait dans la plupart des runs affichés ; sans données de run, il suit la métrique (HPS → heal). Les poids diffèrent selon le rôle.",
    global: "Global = Σ(poids de l'axe × score de l'axe) / Σ(poids de l'axe) sur les axes qui ont pu être notés, avec les poids du rôle du joueur, arrondi à l'entier. Un axe n/a est exclu des deux sommes, donc il n'aide ni ne pénalise.",
    thresholds: "INVITE quand le score global atteint le seuil d'invite, MAYBE quand il atteint le seuil de maybe, PASS en dessous. Les seuils sont imprimés ci-dessous depuis la configuration de cette instance.",
    confidence: "La confiance ne parle que du nombre de runs enrichis que l'évaluation a vus : haute, moyenne ou basse selon les deux comptes de runs imprimés ci-dessous. Elle ne change pas le score.",
    insufficient: "Avec moins de runs enrichis que le minimum imprimé ci-dessous, le verdict est PAS ASSEZ DE DONNÉES quel que soit le score : il n'y a pas assez de signal pour dire quoi que ce soit.",
  },
  levelScale: "Une mort à haute key n'est pas une mort à basse key. Pour les sous-signaux basés sur les morts, le compte de chaque run est multiplié par un facteur lu au niveau de key de ce run (pas la cible que tu as demandée, donc demander une key plus dure ne rend jamais les mêmes morts meilleures ou pires), avant de passer par la courbe. Entre deux niveaux listés le facteur est interpolé ; en dehors il est borné.",
  expectedIlvl: "L'item level est jugé face à ce qu'un perso est censé porter au niveau de key cible cette saison. La valeur attendue est interpolée entre les niveaux listés et bornée en dehors ; la saison est celle que Raider.IO rapporte pour le perso, sinon la plus récente que cette instance connaît.",
  axes: {
    survival: {
      title: "Survie",
      summary: "Si le joueur reste en vie et facilite la vie du heal : morts, dégâts subis, dégâts évitables et — une fois des runs analysés en deep-dive — comment il utilise ses defensives.",
      why: "Dans une key, une mort coûte du temps et souvent le run ; le log montre exactement quelles morts étaient évitables.",
      subSignals: {
        individualDeaths: { title: "Morts individuelles", what: "Morts du joueur qui ne faisaient pas partie d'un wipe du groupe, par run.", source: "Le log de chaque run : les événements de mort du joueur. Une mort est « en wipe » quand au moins 3 membres du groupe sont morts à moins de 15 secondes d'elle.", how: "Pour chaque run, le nombre de morts hors wipe × le facteur de niveau de la key de ce run ; puis la moyenne sur les runs enrichis. La ligne d'indice montre la moyenne non pondérée.", why: "Le meilleur prédicteur qu'un joueur mourra aussi dans ta key.", naWhen: "Jamais : chaque run enrichi a des données de morts (zéro mort est une valeur).", unit: "morts par run, pondérées par niveau", scaledByLevel: true },
        wipeDeaths: { title: "Morts en wipe", what: "Morts du joueur survenues pendant un wipe du groupe, par run.", source: "Le log de chaque run, les mêmes événements de mort, ceux marqués « en wipe » (3 morts ou plus dans le groupe en 15 secondes).", how: "Moyenne sur les runs enrichis du nombre de morts en wipe. Pas pondérée par niveau.", why: "Les wipes sont surtout le fait du groupe ; ils sont comptés à part, avec un poids plus faible, pour qu'un mauvais pull ne passe pas pour une faute personnelle.", naWhen: "Jamais.", unit: "morts par run", scaledByLevel: false },
        avoidableVsPeers: { title: "Dégâts évitables vs pairs", what: "Dégâts subis des mécaniques que la liste de la saison marque comme évitables, comparés aux autres joueurs du même run.", source: "Le log de chaque run filtré par la liste des dégâts évitables de la saison (la même classification que le récap de mort en jeu) ; ici tout le groupe est pair.", how: "Par run : dégâts évitables par minute, puis (toi − médiane des pairs) / médiane des pairs en % ; la médiane de ça sur les runs qui ont une comparaison.", why: "Rester dans les zones est invisible dans un parse et très visible dans une key.", naWhen: "Quand aucun run n'a de comparaison : le donjon n'a pas de liste d'évitables, les tables de dégâts du combat manquent, ou aucun pair n'a pris de dégâts évitables (la médiane est 0).", unit: "% vs pairs", scaledByLevel: false },
        dtpsVsPeers: { title: "Dégâts subis vs pairs", what: "Tous les dégâts subis par seconde, comparés aux joueurs DPS du même run.", source: "La table de dégâts subis de chaque run ; les pairs sont les DPS seulement, donc la prise plus grosse du tank ne fausse jamais la comparaison.", how: "Par run : (tes DTPS − DTPS médians des pairs) / médiane des pairs en % ; la médiane sur les runs. Les poids par rôle à côté de la courbe montrent combien ça compte pour chaque rôle.", why: "Prendre plus que les autres DPS du même groupe, c'est du heal en plus pour le même output.", naWhen: "Quand aucun run n'a de pairs DPS avec des données de dégâts (pour un tank la comparaison n'est pas calculée du tout).", unit: "% vs pairs", scaledByLevel: false },
        groupDeaths: { title: "Morts des coéquipiers", what: "Morts des quatre autres joueurs, par run — un signal de heal.", source: "Le log de chaque run : toutes les morts du groupe moins celles du joueur.", how: "Par run, morts des coéquipiers × le facteur de niveau de la key de ce run ; la moyenne sur les runs. Les poids par rôle à côté de la courbe montrent pour quels rôles ça compte.", why: "Pour un heal, les morts du groupe sont en partie les siennes.", naWhen: "Jamais pour un heal ; pas compté pour les autres rôles.", unit: "morts de coéquipiers par run, pondérées par niveau", scaledByLevel: true },
        defensiveUsage: { title: "Utilisation des defensives", what: "Quelle part des utilisations possibles des majors et immunités le joueur a vraiment castée, d'après les analyses deep-dive.", source: "Analyse deep-dive du run (le bouton Analyser) : casts de chaque major/immunité de la table de la spec face au nombre de fois où il aurait pu revenir de cooldown pendant le combat.", how: "Par defensive : min(1, casts / capacité) avec capacité = ceil(durée du combat / cooldown), au moins 1 ; par run la moyenne sur les majors et immunités ; puis la médiane sur les runs analysés parmi les affichés.", why: "Un joueur qui garde ses defensives dans la poche est celui qui meurt au prochain coup inévitable.", naWhen: "Tant que le minimum de runs affichés imprimé ci-dessous n'a pas été analysé ; aussi quand la table de la spec n'a aucune entrée major ou immunité.", unit: "part des utilisations possibles (0–1)", scaledByLevel: false },
        avoidableDeaths: { title: "Morts avec un defensive dispo", what: "Part des morts du joueur où une immunité ou un major était disponible et pas utilisé, d'après les analyses deep-dive.", source: "Analyse deep-dive : pour chaque mort hors wipe, quels defensives étaient disponibles, actifs ou en cooldown à ce moment-là.", how: "Sur les runs affichés analysés : morts jugées « immunité dispo » ou « defensive dispo » divisées par toutes les morts hors wipe ; « couvert » (un defensive était actif) et « rien de dispo » ne comptent pas contre le joueur.", why: "Une mort avec un defensive en main est la plus évitable qui soit.", naWhen: "Tant que le minimum de runs analysés n'est pas atteint, et quand les runs analysés ne contiennent aucune mort hors wipe.", unit: "part des morts (0–1)", scaledByLevel: false },
      },
    },
    utility: {
      title: "Utilité",
      summary: "Kicks, normalisés par ce que la spec pouvait physiquement caster, et dispels.",
      why: "Dans une key, un kick raté est un cast qui tombe sur le groupe ; l'utilité, c'est là où un bon joueur se sent plus qu'il ne se voit.",
      subSignals: {
        kicksVsPeers: { title: "Kicks vs pairs", what: "Utilisation des kicks comparée aux DPS et tanks du même run.", source: "La table de kicks de chaque run ; l'utilisation de chaque joueur est normalisée par le cooldown de kick de sa propre spec, pour ne pas favoriser une spec au kick court.", how: "Utilisation = kicks / (durée du combat / cooldown du kick). Par run : ton utilisation − la médiane des pairs, en points de pourcentage ; la médiane sur les runs.", why: "Comparée dans le même nombre de pulls et les mêmes affixes, la mesure de kick la plus juste qui soit.", naWhen: "Quand la spec n'a pas de kick, ou quand aucun run n'a de table de kicks.", unit: "points de pourcentage vs pairs", scaledByLevel: false },
        kicksAbsolute: { title: "Capacité de kick utilisée", what: "L'utilisation des kicks seule : quelle part des kicks possibles le joueur a castée.", source: "La table de kicks de chaque run et le cooldown de kick de base de la spec.", how: "Utilisation = kicks / (durée du combat / cooldown du kick), par run ; la médiane sur les runs.", why: "Même un groupe qui kicke peu ne doit pas cacher un joueur qui ne kicke jamais.", naWhen: "Quand la spec n'a pas de kick.", unit: "part des kicks possibles (0–1)", scaledByLevel: false },
        dispels: { title: "Dispels", what: "Dispels, purges, spellsteals et soothes par run.", source: "La table de dispels de chaque run (Warcraft Logs compte ensemble les dispels alliés, les purges ennemies et les dispels de pet).", how: "La médiane sur les runs du nombre par run.", why: "Dispel, c'est la part de l'utilité qui dépend de l'attention plutôt que du kit.", naWhen: "Quand la classe n'a aucun dispel ni purge (rogues, warriors, death knights) : n/a, pas 0. L'axe entier n'est n/a que quand ni kick ni dispel ne s'applique ; les heals sont toujours notés.", unit: "dispels par run", scaledByLevel: false },
      },
    },
    throughput: {
      title: "Throughput",
      summary: "Parse % sur la métrique choisie : global et au niveau de key cible.",
      why: "L'output est ce pour quoi le groupe a signé ; le parse le compare déjà à celui de tous les autres sur la même key et le même set de boss.",
      subSignals: {
        medianParse: { title: "Parse médian", what: "Le parse % médian du meilleur run par donjon.", source: "Classements Warcraft Logs (parse % de chaque run sur la métrique choisie).", how: "Médiane sur les runs par donjon que Warcraft Logs a classés. Un parse à 0 % veut dire un log non classé et il est exclu.", why: "Un seul nombre pour « à quel point il joue bien sa spec » sur toute la saison.", naWhen: "Quand aucun des runs affichés n'est encore classé.", unit: "parse %", scaledByLevel: false },
        parseAtTarget: { title: "Parse à la cible", what: "Parse % sur les runs au niveau de key cible ou juste en dessous.", source: "Classements Warcraft Logs.", how: "Parse médian des runs affichés classés dont le niveau de key est au moins la cible moins 1.", why: "Un bon parse en +12 dit peu sur une +20 ; celui-ci regarde les keys qui t'intéressent vraiment.", naWhen: "Quand aucun run classé n'est à cible − 1 ou plus.", unit: "parse %", scaledByLevel: false },
      },
    },
    consistency: {
      title: "Régularité",
      summary: "À quel point le parse, les morts et les dégâts subis varient d'un run à l'autre. Informatif sauf si l'opérateur lui donne un poids d'axe : voir la table des poids sous Le verdict.",
      why: "La variance punit les joueurs qui poussent des keys (une +21 depleted à côté d'une +20 timed n'est pas de l'irrégularité), donc elle est affichée, pas comptée, sauf si l'opérateur en décide autrement.",
      subSignals: {
        parseSpread: { title: "Écart de parse", what: "Écart-type du parse % entre les runs.", source: "Classements Warcraft Logs.", how: "Écart-type (population) sur les runs enrichis classés ; demande au moins le minimum de runs de régularité imprimé ci-dessous.", why: "Un écart de 20 points entre les runs te dit quel parse attendre un mauvais soir.", naWhen: "Sous le minimum de runs classés de régularité.", unit: "± parse %", scaledByLevel: false },
        deathsSpread: { title: "Écart de morts", what: "Écart-type des morts par run.", source: "Le log de chaque run.", how: "Écart-type (population) du nombre de morts par run (toutes les morts, wipes compris) sur les runs enrichis.", why: "Sépare « meurt une fois à chaque run » de « meurt cinq fois dans un run ».", naWhen: "Sous le minimum de runs de régularité.", unit: "± morts", scaledByLevel: false },
        damageSpread: { title: "Écart de dégâts vs pairs", what: "Écart-type de la comparaison de dégâts avec les pairs, par run.", source: "Le log de chaque run : la comparaison des dégâts évitables quand le run en a une, sinon la comparaison des dégâts subis.", how: "Écart-type (population) de ces différences en % par run, sur les runs qui en ont une.", why: "Montre si les dégâts subis sont une habitude ou un accident.", naWhen: "Sous le minimum de runs avec une comparaison de régularité.", unit: "± % vs pairs", scaledByLevel: false },
      },
    },
    preparation: {
      title: "Préparation",
      summary: "Consommables utilisés par run et item level face à ce que le niveau cible attend.",
      why: "Pas cher, entièrement entre les mains du joueur, et un bon indicateur du sérieux avec lequel il prend une key.",
      subSignals: {
        potions: { title: "Potions", what: "Potions de combat utilisées par run.", source: "La table récapitulative de chaque run (utilisations de potions).", how: "Moyenne sur les runs enrichis qui rapportent des consommables.", why: "Une pot par section chargée en pulls fait la différence sur un timer serré.", naWhen: "Quand aucun run enrichi ne rapporte de consommables.", unit: "potions par run", scaledByLevel: false },
        healthstones: { title: "Healthstones", what: "Healthstones utilisées par run.", source: "La table récapitulative de chaque run (utilisations de healthstones).", how: "Moyenne sur les runs enrichis qui rapportent des consommables.", why: "Utiliser la healthstone avant de mourir est le defensive le moins cher qui soit.", naWhen: "Quand aucun run enrichi ne rapporte de consommables.", unit: "healthstones par run", scaledByLevel: false },
        ilvlVsLevel: { title: "Item level vs cible", what: "Item level moins ce que la saison attend au niveau de key cible.", source: "Raider.IO (item level) et la courbe d'item level attendu de cette instance pour la saison.", how: "Item level − attendu(niveau cible), en niveaux d'item ; la valeur attendue est interpolée depuis la courbe imprimée sous Item level attendu.", why: "Sous-stuffé pour la key, c'est un problème de survie et de throughput qui n'attend que d'arriver ; sur-stuffé, c'est très bien.", naWhen: "Quand Raider.IO n'a pas d'item level pour le perso.", unit: "ilvl vs attendu", scaledByLevel: false },
      },
    },
    experience: {
      title: "Expérience",
      summary: "Quelle part de la saison le joueur a faite au niveau que tu demandes, et depuis combien de temps.",
      why: "Un joueur qui a timed chaque donjon à ton niveau a déjà résolu les problèmes que tu vas rencontrer.",
      subSignals: {
        coverage: { title: "Couverture des donjons", what: "Part des donjons de la saison où le joueur a un run.", source: "Classements Warcraft Logs (meilleur run par donjon).", how: "Donjons avec au moins un run / donjons de la saison.", why: "Huit donjons en +15 battent un seul en +20 quand le groupe a besoin des huit.", naWhen: "Quand la saison n'a aucun donjon listé (jamais en pratique).", unit: "part des donjons (0–1)", scaledByLevel: false },
        atTarget: { title: "Donjons à la cible", what: "Part des donjons de la saison avec un run au niveau cible ou plus.", source: "Classements Warcraft Logs.", how: "Donjons dont le meilleur run est au niveau cible ou plus / donjons de la saison.", why: "La réponse la plus directe à « a-t-il déjà fait cette key ».", naWhen: "Comme la couverture.", unit: "part des donjons (0–1)", scaledByLevel: false },
        medianVsTarget: { title: "Key médiane vs cible", what: "Le niveau auquel le joueur joue vraiment, comparé à la cible.", source: "Classements Warcraft Logs : le niveau de key médian du meilleur run par donjon (le nombre qui auto-détecte la cible, avant arrondi).", how: "Niveau médian des meilleurs runs − niveau cible, en niveaux de key.", why: "La médiane ignore le push depleted isolé et te dit où il est à l'aise.", naWhen: "Quand il n'y a aucun run cette saison.", unit: "niveaux de key vs cible", scaledByLevel: false },
        activity: { title: "Activité récente", what: "Runs terminés dans les 7 derniers jours.", source: "Runs récents Raider.IO.", how: "Nombre de runs dont la date de fin est dans les 7 derniers jours.", why: "Quelqu'un qui n'a pas joué depuis un mois est rouillé sur les affixes du moment.", naWhen: "Quand Raider.IO n'a pas de profil pour le perso.", unit: "runs sur les 7 derniers jours", scaledByLevel: false },
      },
      extras: {
        prevSeasonBonus: { title: "Bonus saison précédente", what: "Un petit bonus — jamais une pénalité — pour un bon score Raider.IO de la saison précédente.", how: "Bonus = min(10, score de la saison précédente / 400) points d'axe, ajouté au score d'Expérience après les courbes et borné à 100. Il apparaît comme sa propre ligne d'indice.", why: "Un joueur de retour avec une bonne saison précédente mérite le bénéfice du doute tant que les données de cette saison sont minces." },
      },
    },
  },
  notScored: [
    { title: "Timed vs depleted", text: "Affiché dans la liste des runs avec le nombre de coffres et le temps, jamais noté : une key depleted sur un run par ailleurs solide est en général le fait du groupe, pas du joueur." },
    { title: "Parses non classés", text: "Un parse à 0 % veut dire que Warcraft Logs n'a pas (encore) classé ce log. Il est affiché « non classé » et exclu de chaque signal basé sur le parse au lieu de compter comme un mauvais parse." },
    { title: "Affixes et routes", text: "Pas lus du tout. Les pairs sont comparés dans le même run, donc le nombre de pulls et les affixes s'annulent." },
    { title: "Chat, kicks du groupe, historique de leave", text: "Pas dans les données que bmpl lit." },
  ],
  runSignals: [
    { title: "Timed / depleted", text: "D'après les données de keystone du combat : timed avec le nombre de coffres et le temps, ou depleted." },
    { title: "Morts", text: "Les morts du joueur avec ce qui l'a tué ; les morts en wipe (3 morts ou plus dans le groupe en 15 secondes) sont marquées comme telles." },
    { title: "DTPS vs pairs", text: "Dégâts subis par seconde comparés aux joueurs DPS du run, en %." },
    { title: "Évitable vs pairs", text: "Dégâts de la liste d'évitables de la saison, par minute, comparés à tous les autres du run, en %." },
    { title: "Kicks vs pairs", text: "Utilisation des kicks normalisée par le cooldown de kick de la spec, moins la médiane DPS et tanks du run, en points de pourcentage." },
    { title: "Dispels", text: "Dispels, purges, spellsteals et soothes dans le run ; n/a pour les classes qui n'en ont pas." },
    { title: "Ancien", text: "Un run de plus de 14 jours porte un badge « ancien » : la forme actuelle du joueur peut différer." },
  ],
  deepdive: {
    summary: "Le deep-dive va un cran plus loin que les signaux par run : il récupère les événements de cast et de buff d'un run et mesure, par defensive, l'utilisation face à la capacité, et pour chaque mort si un defensive était dispo et inutilisé. C'est optionnel (les boutons Analyser) parce que c'est une requête plus lourde.",
    usage: "Pour chaque defensive de la table de la spec : capacité = combien de fois il aurait pu revenir de cooldown pendant le combat (ceil(durée du combat / cooldown), au moins 1) ; utilisation = casts / capacité, plafonnée à 1. Les majors et immunités alimentent l'axe Survie ; les minors sont seulement affichés.",
    deaths: "Pour chaque mort : « immunité dispo » (une immunité était disponible), « defensive dispo » (un major était disponible et aucun n'était actif), « couvert » (un defensive était actif quand le joueur est mort) ou « rien de dispo ». Les deux premières sont les morts évitables. Les morts pendant un wipe du groupe ont aussi un verdict mais sont exclues du ratio.",
    table: "Quels sorts comptent comme defensives par spec est une table versionnée livrée avec bmpl ; les corrections faites depuis le panneau s'appliquent à toi immédiatement et, sur une instance partagée, à tout le monde une fois qu'un admin les a approuvées.",
    cost: "Environ 3 points Warcraft Logs par run, une seule fois ; les analyses sont mises en cache pour toujours et montrées à tous ceux qui ouvrent le même run.",
  },
  faq: [
    { q: "Pourquoi Utilité est n/a pour ce joueur ?", a: "La spec n'a ni kick ni dispel (rogues, warriors et death knights n'ont pas de dispel ; quelques specs n'ont pas de kick). Quand un seul des deux s'applique, l'autre sous-signal est sauté et l'axe est noté sur ce qui reste. Les heals sont toujours notés, puisque leurs dispels seuls sont un signal." },
    { q: "Pourquoi un axe dit n/a alors que d'autres sont notés ?", a: "Chaque sous-signal a une condition sous laquelle il ne peut pas être calculé (listée en « n/a » sur sa carte). Un axe est n/a quand aucun de ses sous-signaux n'a pu être calculé, ou quand son minimum de runs n'est pas atteint (Régularité)." },
    { q: "Pourquoi PAS ASSEZ DE DONNÉES alors que le perso a un gros score Raider.IO ?", a: "Le verdict a besoin d'un minimum de runs enrichis (imprimé sous Le verdict). Un gros score avec peu de runs loggés, ou des runs dont les logs n'ont pas pu être récupérés, n'est pas assez de signal." },
    { q: "Le score ne colle pas avec le score Raider.IO — lequel a raison ?", a: "Ils mesurent des choses différentes. Raider.IO note à quelle hauteur étaient les keys ; bmpl note comment le joueur a joué dedans. Un gros score Raider.IO avec un score bmpl bas veut en général dire un joueur carry dans ses keys ; l'inverse, un bon joueur qui n'a pas encore push." },
    { q: "Pourquoi une key depleted n'est pas retenue contre lui ?", a: "Une key depleted est en général le fait du groupe. Elle est affichée dans la liste des runs comme contexte et jamais notée." },
    { q: "Les nombres ont changé depuis hier. Pourquoi ?", a: "Rafraîchir a tout récupéré à nouveau : de nouveaux runs remplacent les anciens meilleurs runs par donjon, les scores Raider.IO bougent, et Warcraft Logs classe les logs après coup (un parse non classé devient un vrai parse). Sur une instance partagée, tu as aussi pu recevoir la recherche d'un autre membre faite jusqu'à 6 heures plus tôt. L'évaluation est recalculée à chaque fois depuis les données courantes." },
    { q: "Je peux vérifier les nombres moi-même ?", a: "Oui : chaque run pointe vers son report Warcraft Logs. Morts, dégâts subis, kicks et dispels sont les tables du report lui-même ; la comparaison aux pairs est la médiane des autres joueurs de ce run sur la même table ; les courbes et les poids sont imprimés sur cette page." },
    { q: "Pourquoi le même perso a un verdict différent à un autre niveau de key ?", a: "Le niveau cible change ce qui est comparé : parse à la cible, donjons à la cible, key médiane vs cible et l'item level attendu bougent tous avec lui. Les morts sont pondérées par le niveau de chaque run, pas par la cible, donc la pondération elle-même ne bouge pas ; seul le run supplémentaire au niveau le plus proche sous la cible peut changer quels runs sont comptés." },
    { q: "Combien de points Warcraft Logs coûte une recherche ?", a: "Environ 10 pour les classements, plus environ 10 par run affiché dont le log n'est pas encore en cache, plus environ 3 par analyse deep-dive. Les runs et analyses en cache ne coûtent rien.", hostedOnly: false },
    { q: "C'est quoi le quota dans le menu utilisateur ?", a: "Sur une instance partagée, chaque membre a un budget horaire de points Warcraft Logs ; les données en cache ne comptent jamais. Quand le budget est atteint, les recherches qui devraient récupérer des données sont refusées jusqu'au reset de l'heure. Les membres qui ajoutent leur propre client Warcraft Logs dans les Paramètres tournent sur leur propre budget à la place.", hostedOnly: true },
    { q: "Qu'est-ce que l'instance stocke sur moi ?", a: "Voir la page Confidentialité : ton id, ton nom et ton avatar Discord, ton historique de recherches et tes paramètres, ton usage horaire, tes corrections, et — si tu en as ajouté un — ton client Warcraft Logs avec son secret chiffré.", hostedOnly: true },
  ],
  wclClient: {
    title: "Ton propre client Warcraft Logs",
    why: "Chaque recherche qui n'est pas déjà en cache dépense des points Warcraft Logs. Sur cette instance tu partages un petit budget horaire avec les autres membres ; avec ton propre client — gratuit, deux minutes à créer — tu as le budget complet de Warcraft Logs pour toi seul et tu n'attends plus jamais le reset de l'heure.",
    sharedHint: "budget partagé, par membre",
    ownHint: "ton propre client, personne d'autre dessus",
    onWcl: [
      "Connecte-toi sur [warcraftlogs.com](https://www.warcraftlogs.com/) — n'importe quel compte gratuit fait l'affaire.",
      "Ouvre [warcraftlogs.com/api/clients](https://www.warcraftlogs.com/api/clients) (avatar → Clients) et clique sur Create Client.",
      "Donne-lui n'importe quel nom (disons `bmpl`), mets `http://localhost` en Redirect URLs, laisse Public Client? décoché, valide.",
      "Copie le Client ID et le Client Secret — le secret n'est affiché qu'une fois.",
    ],
    inBmpl: [
      "Ouvre [Paramètres → client Warcraft Logs](/settings#wcl-client), colle les deux, Enregistrer et vérifier.",
      "C'est fait : la ligne de quota dans ton menu montre maintenant ton propre compteur, et tes recherches ne touchent plus au budget partagé.",
    ],
    safety: "Le secret est stocké chiffré et n'est envoyé qu'à Warcraft Logs. S'il fuit, supprime le client sur la même page et crée-en un nouveau.",
  },
  liveAddon: {
    title: "L'addon en jeu",
    why: "Le panneau Live lit une petite bande de pixels que l'addon bmpl dessine en jeu, via un partage d'écran — pas d'aller-retour serveur, l'addon n'a aucun code réseau à lui. Installe-le une fois et chaque candidat et membre de groupe que tu vois dans le Group Finder apparaît ici automatiquement, avec classe, rôle et score. Le spec d'un candidat tank ou heal est exact ; le spec d'un candidat DPS est une estimation au mieux, parce que le Group Finder de Blizzard ne l'expose pas avant que tu l'invites.",
    install: [
      "Télécharge `bmpl-addon.zip` (depuis les releases du repo, ou construis-le toi-même avec `just addon-zip`) et décompresse-le.",
      "Copie le dossier `bmpl` dans `World of Warcraft/_retail_/Interface/AddOns/`.",
      "`/reload`, et coche bmpl dans la liste des AddOns si ce n'est pas déjà fait.",
    ],
    connect: [
      "Clique sur la puce Live dans l'en-tête, puis Choisir la fenêtre, et partage la fenêtre World of Warcraft dans le dialogue du navigateur.",
      "Ouvre le Group Finder en jeu, ou aie une annonce active — la bande apparaît en haut à gauche et ce panneau se remplit en quelques secondes.",
    ],
    sends: "L'addon n'envoie rien, ne reçoit rien et ne stocke rien — il ne fait que dessiner des pixels. Le navigateur les lit localement ; seuls les noms de joueurs qu'il y reconnaît sont envoyés à bmpl, pour vérifier ce qu'il sait déjà.",
  },
};

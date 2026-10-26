# Analyseur Tactique

Overlay pour League of Legends orienté **jungle**. Il se connecte au client, choisit et envoie la meilleure
page de runes, puis construit un ordre d'objets qui s'adapte :

- **avant la partie**, à la composition adverse (AP/AD, tanks, contrôles, soins, burst, boucliers, critiques) ;
- **pendant la partie**, à son déroulé (adversaire qui prend de l'avance, objets réellement achetés, armure/RM
  accumulées, avance ou retard de l'équipe, or disponible → prochain achat).

## Fonctionnement

| Élément                              | Rôle                                                                                                                                                                  |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main/lcu.ts`                    | Connexion au client (reconnexion automatique), sélection des champions, page de runes « Tactique », runes recommandées par Riot, set d'objets pour la boutique en jeu |
| `src/main/live.ts`                   | API en jeu de Riot (127.0.0.1:2999), vérifiée avec le certificat racine Riot                                                                                          |
| `src/renderer/src/data/junglers.ts`  | Base de builds jungle (patch 26.21) : runes, cœur, options, ordre des compétences                                                                                     |
| `src/renderer/src/data/champions.ts` | Profil de dégâts/menace de chaque champion                                                                                                                            |
| `src/renderer/src/data/items.ts`     | Règles de choix des objets situationnels, groupes d'objets uniques, anti-soins                                                                                        |
| `src/renderer/src/engine/`           | Moteur : données Riot, analyse de menace, runes, objets, catalogue, vérification                                                                                      |

### Runes toujours à jour

- Réglage « Source des runes » : **Auto** (par défaut) utilise la base tactique tant que son patch correspond au
  jeu, puis bascule sur les **recommandations Riot du patch en cours** dès que le jeu change de patch.
- Les fragments défensifs s'adaptent (ténacité contre beaucoup de contrôles, PV contre le burst).
- L'app ne modifie jamais vos pages : elle crée/met à jour sa propre page « Tactique ». Si toutes les pages
  sont utilisées, un message l'indique (option « Remplacer la page active » pour l'autoriser).

### Mettre la méta à jour sans recompiler

Hébergez un JSON (ex. GitHub Gist, lien « raw ») et collez son URL dans Réglages → Mise à jour de la méta :

```json
{
  "patch": "16.22",
  "builds": [
    {
      "id": "LeeSin",
      "archetype": "AD_FIGHTER",
      "pet": "Scorchclaw Pup",
      "boots": "Plated Steelcaps",
      "core": ["Eclipse", "Black Cleaver", "Death's Dance"],
      "options": ["Guardian Angel", "Maw of Malmortius", "Sterak's Gage"],
      "skills": "Q>W>E",
      "runes": {
        "keystone": "Conqueror",
        "primary": ["Triumph", "Legend: Alacrity", "Coup de Grace"],
        "secondaryTree": "Inspiration",
        "secondary": ["Magical Footwear", "Cosmic Insight"],
        "shards": ["AS", "AF", "HS"]
      }
    }
  ]
}
```

Noms en anglais (comme Data Dragon). Fragments : ligne 1 `AF`/`AS`/`AH`, ligne 2 `AF`/`MS`/`HS`,
ligne 3 `HP`/`TN`/`HS`. Archétypes : `AD_FIGHTER`, `AD_ASSASSIN`, `AD_CARRY`, `AP_FIGHTER`, `AP_BURST`,
`TANK`, `ENCHANTER`. Les noms inconnus sont signalés dans Réglages → Diagnostic.

## Utilisation

- En jeu, réglez l'affichage sur **Sans bordures** (le plein écran exclusif masque les overlays).
- Survolez la languette sur le bord de l'écran, ou **Ctrl + Maj + T** pour épingler le panneau.

## Développement

```bash
npm install
npm run dev        # lancement en développement
npm run typecheck  # vérification des types
npm run build:win  # exécutable portable Windows (dist/)
```

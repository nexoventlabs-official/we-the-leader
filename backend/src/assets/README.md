# Card Generator Assets

The card generator automatically resolves assets from the project's existing
`Id cards/` folder (sibling to the `backend/` directory):

```
ANNAMALAI_MEMBERSHIP/
├── Id cards/
│   ├── leader.png              ← leader silhouette image
│   ├── Montserrat-ExtraBold.ttf
│   ├── Outfit-Bold.ttf
│   └── PlusJakartaSans-Bold.ttf
└── backend/
    └── src/assets/             ← this folder (fallback only)
```

If you run the backend from a different working directory, place copies of the
above files here as a fallback.

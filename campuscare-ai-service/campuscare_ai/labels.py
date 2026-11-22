"""Label vocabulary. Category ids must match campuscare-backend/src/constants.js."""

CATEGORIES = [
    "electrical",
    "plumbing",
    "sanitation",
    "security",
    "hostel",
    "transport",
    "academic",
    "it",
    "infrastructure",
]

CATEGORY_LABELS = {
    "electrical": "Electrical",
    "plumbing": "Water & plumbing",
    "sanitation": "Sanitation",
    "security": "Security",
    "hostel": "Hostel",
    "transport": "Transport",
    "academic": "Classrooms & labs",
    "it": "Wi-Fi & IT",
    "infrastructure": "Building & furniture",
}

LEVELS = [1, 2, 3, 4, 5]  # severity and urgency scale

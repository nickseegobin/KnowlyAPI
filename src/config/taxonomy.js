// ============================================================
// Knowly — Topic Taxonomy
// Source: T&T Ministry of Education Primary Curriculum Guides
//         Standard 4 and Standard 5
// ============================================================

const TAXONOMY = {

  // ─────────────────────────────────────────────────────────
  // STANDARD 4
  // ─────────────────────────────────────────────────────────
  std_4: {

    math: {
      term_1: [
        {
          topic: "Number Concepts and Place Value",
          subtopics: [
            "Place value up to 1 000 000",
            "Comparing and ordering whole numbers",
            "Expanded notation",
            "Rounding to the nearest thousand",
            "Factors and multiples",
            "Prime and composite numbers",
            "Square numbers and square roots"
          ]
        },
        {
          topic: "Number Patterns",
          subtopics: [
            "Repeating, increasing and decreasing patterns",
            "Patterns with fractions, decimals and whole numbers",
            "Pattern rules and prediction",
            "Patterns involving multiplication and division"
          ]
        },
        {
          topic: "Number Relationships and Operations",
          subtopics: [
            "Addition and subtraction of whole numbers",
            "Multiplication of whole numbers",
            "Division of whole numbers",
            "Order of operations",
            "Mental math strategies",
            "Estimation strategies"
          ]
        }
      ],
      term_2: [
        {
          topic: "Fractions",
          subtopics: [
            "Addition of unlike fractions",
            "Subtraction of unlike fractions",
            "Multiplication of fractions by whole numbers",
            "Division of whole numbers by fractions",
            "Fractions of a collection",
            "Finding the whole given a part"
          ]
        },
        {
          topic: "Decimals",
          subtopics: [
            "Representing decimals to hundredths",
            "Comparing and ordering decimals",
            "Rounding decimal fractions",
            "Converting fractions to decimals",
            "Addition and subtraction of decimals",
            "Money and decimals"
          ]
        },
        {
          topic: "Geometry — Solids and Plane Shapes",
          subtopics: [
            "Properties of solids",
            "Properties of plane shapes",
            "Classifying polygons",
            "Drawing regular and irregular shapes"
          ]
        },
        {
          topic: "Geometry — Angles and Triangles",
          subtopics: [
            "Types of angles",
            "Drawing and measuring angles",
            "Scalene, isosceles and equilateral triangles",
            "Right-angled triangles",
            "Properties of triangle sides and angles"
          ]
        }
      ],
      term_3: [
        {
          topic: "Measurement — Length and Perimeter",
          subtopics: [
            "Converting units of length",
            "Perimeter of regular shapes",
            "Perimeter of irregular shapes",
            "Solving problems involving length"
          ]
        },
        {
          topic: "Measurement — Mass, Time, Capacity and Volume",
          subtopics: [
            "Converting kilograms and grams",
            "Solving problems involving mass",
            "Converting minutes and hours",
            "Solving problems involving time",
            "Measuring volume in cubic units",
            "Capacity and volume relationships"
          ]
        },
        {
          topic: "Measurement — Area",
          subtopics: [
            "Area using square centimetres and square metres",
            "Area of regular shapes",
            "Estimating area of irregular shapes"
          ]
        },
        {
          topic: "Statistics",
          subtopics: [
            "Collecting and recording data",
            "Tally charts and frequency tables",
            "Pictographs and bar graphs",
            "Interpreting graphs",
            "Mode of a data set",
            "Scale in graphs"
          ]
        }
      ]
    },

    english: {
      term_1: [
        {
          topic: "Oral Communication",
          subtopics: [
            "Listening for main idea and supporting details",
            "Using 5Ws and H to gain meaning",
            "Oral summaries of aural texts",
            "Fact and opinion in spoken texts",
            "Standard English pronunciation"
          ]
        },
        {
          topic: "Reading — Word Attack and Vocabulary",
          subtopics: [
            "Phonics and word families",
            "Context clues and vocabulary",
            "Synonyms and antonyms",
            "Figurative language — simile and metaphor",
            "Homophones and homographs",
            "Multiple-meaning words"
          ]
        },
        {
          topic: "Reading — Comprehension",
          subtopics: [
            "Main idea and supporting details",
            "Literal, inferential and evaluative questions",
            "Cause and effect",
            "Making predictions",
            "Summarising texts",
            "Author's purpose and point of view"
          ]
        }
      ],
      term_2: [
        {
          topic: "Literary Appreciation",
          subtopics: [
            "Plot and character analysis",
            "Theme in literature",
            "Figures of speech in poetry",
            "Comparing texts with similar themes",
            "Point of view in narratives",
            "Drawing conclusions and inferences"
          ]
        },
        {
          topic: "Writing — Grammar and Mechanics",
          subtopics: [
            "Subject-verb agreement",
            "Punctuation — commas, quotation marks, apostrophes",
            "Capitalisation rules",
            "Sentence types and enrichment",
            "Conjunctions and connectives",
            "Spelling rules and patterns"
          ]
        },
        {
          topic: "Writing — Composition",
          subtopics: [
            "Narrative-descriptive writing",
            "Expository writing — reports and instructions",
            "Topic sentences and supporting details",
            "Paragraphing and organisation",
            "Transitional words and phrases",
            "The writing process — pre-writing to publishing"
          ]
        }
      ],
      term_3: [
        {
          topic: "Media and Information Literacy",
          subtopics: [
            "Forms of mass media",
            "How advertisements influence choices",
            "Analysing media messages",
            "Freedom of the press",
            "ICT and digital media",
            "Creating simple media texts"
          ]
        }
      ]
    },

    science: {
      term_1: [
        {
          topic: "Individuals and Groups — Growth",
          subtopics: [
            "Biological changes in plants during growth",
            "Biological changes in animals during growth",
            "Measuring physical characteristics",
            "Designing and conducting growth experiments"
          ]
        },
        {
          topic: "Individuals and Groups — Healthy Foods",
          subtopics: [
            "Balanced and natural foods",
            "Ingredients and methods of food preparation",
            "Food-related illnesses",
            "Making healthy food choices"
          ]
        }
      ],
      term_2: [
        {
          topic: "Form and Function — Properties of Materials",
          subtopics: [
            "Ability to transmit sound and light",
            "Absorbency of materials",
            "Strength of materials",
            "Conduction of heat and electricity",
            "Selecting materials for specific purposes"
          ]
        },
        {
          topic: "Form and Function — Stability of Structures",
          subtopics: [
            "Factors affecting stability",
            "Centre of gravity",
            "Shape and base width in structures",
            "Modifying structures to improve stability"
          ]
        }
      ],
      term_3: [
        {
          topic: "Systems and Interaction — Weather and Climate",
          subtopics: [
            "Difference between weather and climate",
            "Observing and recording weather patterns",
            "Natural disasters and extreme weather",
            "Preparing for extreme weather conditions"
          ]
        },
        {
          topic: "Conservation and Sustainability — Energy",
          subtopics: [
            "Renewable sources of energy",
            "Non-renewable sources of energy",
            "Conserving electrical energy",
            "Finite nature of non-renewable resources"
          ]
        },
        {
          topic: "Conservation and Sustainability — Greenhouse Effect",
          subtopics: [
            "The Greenhouse Effect",
            "The Enhanced Greenhouse Effect",
            "Global Warming",
            "Human actions and their impact on the environment"
          ]
        }
      ]
    },

    social_studies: {
      term_1: [
        {
          topic: "Media and Information",
          subtopics: [
            "Forms of mass media — print, electronic, social",
            "Role and significance of media in society",
            "How advertisements influence behaviour",
            "Freedom of the press as a constitutional right",
            "ICT and communication technology",
            "Responsible use of social media"
          ]
        },
        {
          topic: "Understanding Change — Personal Development",
          subtopics: [
            "Physical changes during puberty in males and females",
            "Caring for the body during puberty",
            "Changes in family relationships over time",
            "Communicable diseases and their impact",
            "Precautionary measures for communicable diseases"
          ]
        }
      ],
      term_2: [
        {
          topic: "Building a Nation — Political History",
          subtopics: [
            "Political evolution of T&T — Crown Colony to Republicanism",
            "The electoral process and franchise",
            "Traits of a patriotic citizen",
            "Structure of government in Trinidad and Tobago",
            "Functions of central and local government",
            "The Tobago House of Assembly"
          ]
        },
        {
          topic: "Building a Nation — National Pride",
          subtopics: [
            "The four National Awards of T&T",
            "Significance of national awards",
            "The Constitution as the supreme law",
            "Rights and responsibilities of citizens"
          ]
        }
      ],
      term_3: [
        {
          topic: "Our Environment — Geography",
          subtopics: [
            "The four seasons and associated activities",
            "Major climatic divisions of the world",
            "Hemispheres of the world",
            "Continents and oceans",
            "Major lines of latitude",
            "Using maps, atlases and globes"
          ]
        },
        {
          topic: "Our Environment — Economics",
          subtopics: [
            "Personal budgeting",
            "Factors to consider when making purchases",
            "Consumer rights and responsibilities",
            "Institutions that protect consumers"
          ]
        }
      ]
    }
  },

  // ─────────────────────────────────────────────────────────
  // STANDARD 5 — SEA PREP (no term constraint)
  // ─────────────────────────────────────────────────────────
  std_5: {

    math: [
      {
        topic: "Number Concepts and Place Value",
        subtopics: [
          "Place value up to 1 000 000",
          "Comparing and ordering whole numbers",
          "Factors, multiples, prime and composite numbers",
          "Square numbers and square roots",
          "Rounding whole numbers"
        ]
      },
      {
        topic: "Fractions",
        subtopics: [
          "Addition and subtraction of unlike fractions",
          "Multiplication of fractions",
          "Division of whole numbers by fractions",
          "Mixed numbers and improper fractions",
          "Fractions of a quantity"
        ]
      },
      {
        topic: "Decimals",
        subtopics: [
          "Representing decimals to hundredths",
          "Comparing and ordering decimals",
          "Addition and subtraction of decimals",
          "Multiplication of decimals",
          "Converting fractions to decimals and vice versa"
        ]
      },
      {
        topic: "Percentages",
        subtopics: [
          "Converting fractions and decimals to percentages",
          "Finding a percentage of a quantity",
          "Percentage increase and decrease",
          "Solving real-life percentage problems"
        ]
      },
      {
        topic: "Geometry — Plane Shapes and Quadrilaterals",
        subtopics: [
          "Properties of quadrilaterals",
          "Classifying triangles",
          "Properties of angles in shapes",
          "Drawing and constructing shapes"
        ]
      },
      {
        topic: "Measurement — Perimeter and Area",
        subtopics: [
          "Perimeter of regular and irregular shapes",
          "Area of rectangles and squares",
          "Area of triangles",
          "Solving problems involving perimeter and area"
        ]
      },
      {
        topic: "Measurement — Mass, Time, Capacity and Volume",
        subtopics: [
          "Converting units of mass",
          "Solving problems involving time",
          "Volume and capacity relationships",
          "Converting units of capacity"
        ]
      },
      {
        topic: "Statistics",
        subtopics: [
          "Collecting, organising and representing data",
          "Bar graphs, pictographs and line graphs",
          "Interpreting and analysing data",
          "Mean, median and mode",
          "Making decisions based on data"
        ]
      }
    ],

    english: [
      {
        topic: "Oral Communication",
        subtopics: [
          "Listening comprehension strategies",
          "Main idea, supporting details and summary",
          "Fact and opinion",
          "Standard English in formal contexts",
          "Debating and point of view"
        ]
      },
      {
        topic: "Reading — Vocabulary and Word Study",
        subtopics: [
          "Context clues",
          "Figurative language — metaphor, simile, analogy",
          "Synonyms, antonyms, homophones",
          "Technical vocabulary across subjects",
          "Connotative and denotative meaning"
        ]
      },
      {
        topic: "Reading — Comprehension",
        subtopics: [
          "Main idea and supporting details",
          "Literal, inferential and evaluative questions",
          "Cause and effect",
          "Author's purpose and tone",
          "Summarising and paraphrasing",
          "Text-to-self and text-to-world connections"
        ]
      },
      {
        topic: "Literary Appreciation",
        subtopics: [
          "Plot, character and theme",
          "Narrative point of view",
          "Figures of speech in poetry",
          "Comparing and contrasting texts",
          "Drawing conclusions and making inferences"
        ]
      },
      {
        topic: "Writing — Grammar and Mechanics",
        subtopics: [
          "Subject-verb agreement",
          "Punctuation rules",
          "Sentence construction and variety",
          "Spelling rules and patterns",
          "Standard English vs Creole patterns"
        ]
      },
      {
        topic: "Writing — Composition",
        subtopics: [
          "Narrative and descriptive writing",
          "Expository writing — reports, letters, instructions",
          "Persuasive writing",
          "Organisational structure and paragraphing",
          "Editing and revising written work"
        ]
      },
      {
        topic: "Media and Information Literacy",
        subtopics: [
          "Types of media and their purposes",
          "Analysing media messages and bias",
          "Creating media texts for specific audiences",
          "Digital citizenship and internet safety"
        ]
      }
    ],

    science: [
      {
        topic: "Living Things — Growth and Development",
        subtopics: [
          "Growth in plants and animals",
          "Life cycles",
          "Reproduction in plants",
          "Classification of living things"
        ]
      },
      {
        topic: "Healthy Living",
        subtopics: [
          "Balanced diet and nutrition",
          "Food groups and their functions",
          "Diseases related to poor nutrition",
          "Personal hygiene and health"
        ]
      },
      {
        topic: "Properties of Materials",
        subtopics: [
          "Physical properties of materials",
          "Conduction of heat and electricity",
          "Absorbency and permeability",
          "Selecting appropriate materials"
        ]
      },
      {
        topic: "Forces and Structures",
        subtopics: [
          "Stability of structures",
          "Effects of forces on objects",
          "Simple machines and their uses",
          "Centre of gravity"
        ]
      },
      {
        topic: "Earth and Environment",
        subtopics: [
          "Weather and climate",
          "Natural disasters and preparedness",
          "The water cycle",
          "Soil types and their properties"
        ]
      },
      {
        topic: "Energy and Conservation",
        subtopics: [
          "Renewable and non-renewable energy",
          "Conserving energy resources",
          "The Greenhouse Effect and Global Warming",
          "Human impact on the environment",
          "Sustainable practices"
        ]
      },
      {
        topic: "Matter and Its Properties",
        subtopics: [
          "States of matter",
          "Changes of state",
          "Mixtures and solutions",
          "Separating mixtures"
        ]
      }
    ],

    social_studies: [
      {
        topic: "Media, ICT and Communication",
        subtopics: [
          "Forms and functions of mass media",
          "ICT and its influence on society",
          "Responsible use of technology",
          "Freedom of the press"
        ]
      },
      {
        topic: "Personal and Social Development",
        subtopics: [
          "Changes during adolescence",
          "Health and personal responsibility",
          "Family structures and relationships",
          "Communicable diseases and prevention"
        ]
      },
      {
        topic: "Government and Citizenship",
        subtopics: [
          "Political history of Trinidad and Tobago",
          "Structure and functions of government",
          "Democratic processes and voting",
          "Rights and responsibilities of citizens",
          "The Constitution of T&T",
          "National symbols and pride"
        ]
      },
      {
        topic: "Geography and the Environment",
        subtopics: [
          "World map — continents, oceans and hemispheres",
          "Lines of latitude and longitude",
          "Climatic zones and seasons",
          "Natural resources of T&T",
          "Environmental issues"
        ]
      },
      {
        topic: "Economics and Personal Finance",
        subtopics: [
          "Personal budgeting",
          "Consumer rights and responsibilities",
          "Factors influencing purchasing decisions",
          "Local and national economic activity"
        ]
      },
      {
        topic: "Caribbean Heritage and Culture",
        subtopics: [
          "Cultural diversity in the Caribbean",
          "T&T national identity and heritage",
          "Contributions of different ethnic groups",
          "Caribbean integration and CARICOM"
        ]
      },
      {
        topic: "Diversity and Global Citizenship",
        subtopics: [
          "T&T as a diverse society",
          "Human rights",
          "Global issues and responsibilities",
          "T&T's place in the world community"
        ]
      }
    ]
  }
};

// ============================================================
// Block 0: Updated EXAM_CONFIG per Section 5.2
// Standard levels: Easy 10/90s, Medium 15/90s, Hard 20/90s
// Capstone (std_5): SEA papers Math 40/90s, ELA 36/90s
// ============================================================

const EXAM_CONFIG = {
  tt_primary: {
    practice: {
      easy:   { question_count: 10, time_per_question_seconds: 90, total_time_seconds: 900 },   // 15 min
      medium: { question_count: 15, time_per_question_seconds: 90, total_time_seconds: 1350 },  // ~22 min
      hard:   { question_count: 20, time_per_question_seconds: 90, total_time_seconds: 1800 }  // 30 min
    },
    sea_paper: {
      math:    { question_count: 40, time_per_question_seconds: 90, total_time_seconds: 3600 },  // 60 min
      english: { question_count: 36, time_per_question_seconds: 90, total_time_seconds: 3240 } // 54 min
    }
  }
};

// ============================================================
// Block 0: Curriculum Configuration (Section 7.3)
// Supports T&T Primary (current), Caribbean CXC, North American
// ============================================================

const CURRICULUM_CONFIG = {
  tt_primary: {
    curriculum_id: "tt_primary",
    display_name: "T&T Primary (SEA)",
    level_label: "Standard",
    period_label: "Term",
    levels: [
      { id: "std_4", label: "Standard 4", has_periods: true, is_capstone: false },
      { id: "std_5", label: "Standard 5", has_periods: false, is_capstone: true }
    ],
    periods: ["term_1", "term_2", "term_3"],
    subjects: ["math", "english", "science", "social_studies"],
    capstone_subjects: {
      math: {
        topics: [
          "Number Theory",
          "Fractions",
          "Decimals",
          "Percentages",
          "Measurement",
          "Geometry",
          "Statistics",
          "Algebra"
        ],
        full_paper_question_count: 40,
        topic_weightings: {
          "Number Theory": 5,
          "Fractions": 6,
          "Decimals": 5,
          "Percentages": 5,
          "Measurement": 6,
          "Geometry": 6,
          "Statistics": 4,
          "Algebra": 3
        }
      },
      english: {
        topics: [
          "Comprehension",
          "Grammar",
          "Vocabulary",
          "Punctuation",
          "Writing Mechanics"
        ],
        full_paper_question_count: 36,
        topic_weightings: {
          "Comprehension": 10,
          "Grammar": 8,
          "Vocabulary": 8,
          "Punctuation": 5,
          "Writing Mechanics": 5
        }
      },
      // Science and Social Studies don't have standalone full papers in SEA
      science: {
        topics: [
          "Living Things",
          "Matter",
          "Energy",
          "Forces",
          "Earth and Environment"
        ],
        full_paper_question_count: null  // No sea_paper for Science
      },
      social_studies: {
        topics: [
          "History",
          "Geography",
          "Civics",
          "Economics"
        ],
        full_paper_question_count: null  // No sea_paper for Social Studies
      }
    }
  },

  // Future curricula - structure reference only
  caribbean_cxc: {
    curriculum_id: "caribbean_cxc",
    display_name: "Caribbean CXC (CSEC)",
    level_label: "Form",
    period_label: null,
    levels: [
      { id: "form_4", label: "Form 4", has_periods: false, is_capstone: false },
      { id: "form_5", label: "Form 5", has_periods: false, is_capstone: true }
    ],
    periods: [],
    subjects: ["mathematics", "english_a", "biology", "history"]
  },

  north_american: {
    curriculum_id: "north_american",
    display_name: "North American (Grades)",
    level_label: "Grade",
    period_label: "Semester",
    levels: [
      { id: "grade_10", label: "Grade 10", has_periods: true, is_capstone: false },
      { id: "grade_12", label: "Grade 12", has_periods: false, is_capstone: true }
    ],
    periods: ["semester_1", "semester_2"],
    subjects: ["math", "english", "science", "social_studies"]
  }
};

// ============================================================
// Helper Functions
// ============================================================

function getExamConfig(curriculum, type, difficultyOrSubject) {
  const config = EXAM_CONFIG[curriculum];
  if (!config) return null;

  if (type === 'practice') {
    return config.practice[difficultyOrSubject];
  } else if (type === 'sea_paper') {
    return config.sea_paper[difficultyOrSubject];
  }
  return null;
}

function getCurriculumConfig(curriculumId) {
  return CURRICULUM_CONFIG[curriculumId] || null;
}

function isCapstoneLevel(curriculumId, levelId) {
  const config = CURRICULUM_CONFIG[curriculumId];
  if (!config) return false;
  const level = config.levels.find(l => l.id === levelId);
  return level ? level.is_capstone : false;
}

function getLevelConfig(curriculumId, levelId) {
  const config = CURRICULUM_CONFIG[curriculumId];
  if (!config) return null;
  return config.levels.find(l => l.id === levelId) || null;
}

function getSubtopicData(curriculum, level, subject, period, moduleIndex, subtopicIndex) {
  if (curriculum !== 'tt_primary') throw new Error(`Unsupported curriculum: ${curriculum}`);
  const subjectKey = subject.replace(/-/g, '_');
  const modules = TAXONOMY[level]?.[subjectKey]?.[period];
  if (!modules) throw new Error(`No taxonomy for ${level}/${subject}/${period}`);
  const mod = modules[moduleIndex];
  if (!mod) throw new Error(`No module at index ${moduleIndex} for ${level}/${subject}/${period} (${modules.length} modules available)`);
  if (subtopicIndex < 0 || subtopicIndex >= mod.subtopics.length) {
    throw new Error(`No subtopic at index ${subtopicIndex} in module ${moduleIndex} (${mod.subtopics.length} subtopics available)`);
  }
  return {
    module_number: moduleIndex + 1,
    module_title:  mod.topic,
    subtopic:      mod.subtopics[subtopicIndex],
    sort_order:    (moduleIndex * 100) + subtopicIndex,
  };
}

function getCapstoneSubjectConfig(curriculumId, subject) {
  const config = CURRICULUM_CONFIG[curriculumId];
  if (!config || !config.capstone_subjects) return null;
  return config.capstone_subjects[subject] || null;
}

function supportsSeaPaper(curriculumId, subject) {
  const subjectConfig = getCapstoneSubjectConfig(curriculumId, subject);
  return subjectConfig && subjectConfig.full_paper_question_count !== null;
}

// ============================================================
// Legacy Exports (for backward compatibility during transition)
// ============================================================

module.exports = {
  TAXONOMY,
  EXAM_CONFIG,
  CURRICULUM_CONFIG,
  getExamConfig,
  getCurriculumConfig,
  isCapstoneLevel,
  getLevelConfig,
  getCapstoneSubjectConfig,
  supportsSeaPaper,
  getSubtopicData,
};
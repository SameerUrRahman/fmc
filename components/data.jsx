const columns = [
  {name: "INGREDIENT", uid: "ingredientName"},
  {name: "QUANTITY ", uid: "quantity"},
  {name: "UNIT ", uid: "unit"},
  {name:"COST/UNIT ",uid : "cost"},
  {name: "ACTIONS", uid: "actions"},
];

const users = [
  {
    id: 1,
    ingredient: "Flour",
    quantity:"100",
    unit: "tsp",
    cost:"1",
    
  },
  {
    id: 2,
    ingredient: "Sugar",
    quantity:"2",
    unit: "tsp",
    cost:"40",
  },
  {
    id: 3,
    ingredient: "Honey",
    quantity:"100",
    unit: "mg",
    cost:"100",
  },
  {
    id: 4,
    ingredient: "Eggs",
    quantity:"6",
    unit: "ea",
    cost:"69",
  },
  // {
  //   id: 5,
  //   name: "Kristen Copper",
  //   role: "Sales Manager",
  //   team: "Sales",
  //   status: "active",
  //   age: "24",
  //   avatar: "https://i.pravatar.cc/150?u=a092581d4ef9026700d",
  //   email: "kristen.cooper@example.com",
  // },
];

const unitsVolume=[
  {label:"tsp", value:"tsp",unitType:["Volume","Weight"]},
  {label:"tbsp", value:"tbsp",unitType:["Volume","Weight"]},
  {label:"oz", value:"oz",unitType:["Volume","Weight"]},
  {label:"cup", value:"cup",unitType:["Volume","Weight"]},
  {label:"gallon", value:"gallon",unitType:["Volume"]},
  
  {label:"mL", value:"mL",unitType:["Volume"]},
  {label:"L", value:"L",unitType:["Volume"]},
]
const unitsWeight=[
  {label:"pound",value:"pound",unitType:["Weight"]},
  {label:"g",value:"g",unitType:["Weight"]},
  {label:"kg",value:"kg",unitType:["Weight"]},

]
const unitsMultiple=[
  {label:"Each", value:"Each",unitType:["Multiple"]},
  {label:"dozen", value:"dozen",unitType:["Multiple"]},
]
const allUnits = [...unitsVolume, ...unitsWeight, ...unitsMultiple];
// butter,108,ml
const knownIngredients=[
    {ingredient:"butter",unit:"mL",cost:"108",unitType:"Volume"},
    {ingredient:"sugar",unit:"g",cost:"40",unitType:"Weight"},
    {ingredient:"flour",unit:"g",cost:"30", unitType:"Weight"},
    {ingredient:"eggs",unit:"Each",cost:"69",unitType:"Multiple"},
    {ingredient:"milk",unit:"mL",cost:"30",unitType:"Volume"},
    {ingredient:"cocoa",unit:"g",cost:"30",unitType:"Weight"},
    {ingredient:"vanilla",unit:"mL",cost:"30", unitType:"Volume"},
    {ingredient:"baking powder",unit:"g",cost:"30", unitType:"Weight"},
    {ingredient:"baking soda",unit:"g",cost:"30", unitType:"Weight"},
]
// const fetchKnownIngredients = async () => {
//   try {
//     const response = await fetch('https://api.example.com/knownIngredients');
//     const data = await response.json();
//     return data;
//   } catch (error) {
//     console.error('Error fetching knownIngredients:', error);
//     return [];
//   }
// };

// const newknownIngredients = await fetchKnownIngredients();
// console.log(newknownIngredients);
export {columns, users,unitsVolume,unitsWeight,unitsMultiple,allUnits,knownIngredients};

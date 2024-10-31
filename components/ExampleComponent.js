import React, { useEffect, useState } from 'react';
import { getDummyIngredients } from './data';

const ExampleComponent = () => {
  const [ingredients, setIngredients] = useState([]);

  useEffect(() => {
    const data = getDummyIngredients();
    setIngredients(data);
  }, []);

  return (
    <div>
      <h1>Ingredients</h1>
      <ul>
        {ingredients.map((ingredient) => (
          <li key={ingredient.id}>
            {ingredient.ingredient} - {ingredient.quantity} {ingredient.unit} - ${ingredient.cost}
          </li>
        ))}
      </ul>
    </div>
  );
};

export default ExampleComponent;